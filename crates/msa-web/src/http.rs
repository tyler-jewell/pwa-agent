//! Minimal HTTP/1.1 listener (`std` only), including SSE streaming.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::routes::{handle_request, HttpRequest, HttpResponse};
use crate::state::AppState;
use crate::stream::{format_sse, StreamEvent};

/// Serve until `stop` is true.
///
/// # Errors
/// Bind or accept hard failures.
pub fn serve(bind: &str, state: &AppState, stop: &AtomicBool) -> Result<(), String> {
    let listener = TcpListener::bind(bind).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    println!("msa-web listening on http://{bind}/");
    println!("open http://{bind}/a/admin-agent");
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Err(e) = handle_connection(stream, state) {
                    eprintln!("request error: {e}");
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

fn handle_connection(mut stream: TcpStream, state: &AppState) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(15)))
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0_u8; 65_536];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&buf[..n]);
    let req = parse_http(&raw)?;
    let resp = handle_request(state, &req);
    write_http(&mut stream, &resp)
}

fn parse_http(raw: &str) -> Result<HttpRequest, String> {
    let (head, body) = raw
        .split_once("\r\n\r\n")
        .or_else(|| raw.split_once("\n\n"))
        .ok_or_else(|| "malformed HTTP".to_string())?;
    let mut lines = head.lines();
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_ascii_uppercase();
    let target = parts.next().unwrap_or("/");
    let path = target.split('?').next().unwrap_or("/").to_string();
    let mut body = body.to_string();
    let mut hx_request = false;
    let mut accept_sse = false;
    for line in lines {
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            if let Ok(len) = v.trim().parse::<usize>() {
                if body.len() > len {
                    body.truncate(len);
                }
            }
        }
        if lower.starts_with("hx-request:") && lower.contains("true") {
            hx_request = true;
        }
        if lower.starts_with("accept:") && lower.contains("text/event-stream") {
            accept_sse = true;
        }
    }
    Ok(HttpRequest {
        method,
        path,
        body,
        hx_request,
        accept_sse,
    })
}

fn write_http(stream: &mut TcpStream, resp: &HttpResponse) -> Result<(), String> {
    if resp.status == 303 {
        let headers = format!(
            "HTTP/1.1 303 See Other\r\nLocation: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            resp.body
        );
        stream
            .write_all(headers.as_bytes())
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    if let Some(events) = resp.sse_events.as_ref() {
        return write_sse(stream, events, resp.sse_delay_ms);
    }
    let reason = match resp.status {
        200 => "OK",
        404 => "Not Found",
        _ => "Error",
    };
    let headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        resp.status,
        reason,
        resp.content_type,
        resp.body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .map_err(|e| e.to_string())?;
    stream
        .write_all(resp.body.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn write_sse(stream: &mut TcpStream, events: &[StreamEvent], delay_ms: u64) -> Result<(), String> {
    let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
    stream
        .write_all(headers.as_bytes())
        .map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;
    for (i, ev) in events.iter().enumerate() {
        if delay_ms > 0 && i > 0 {
            std::thread::sleep(Duration::from_millis(delay_ms));
        }
        let frame = match ev {
            StreamEvent::Thinking => format_sse("thinking", "Thinking…"),
            StreamEvent::Token(t) => format_sse("token", t),
            StreamEvent::Done { full, .. } => format_sse("done", full),
        };
        stream
            .write_all(frame.as_bytes())
            .map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}
