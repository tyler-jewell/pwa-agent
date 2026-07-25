//! First-party browser scripts (served as static assets; not a framework).

/// Chat UX: Enter sends, clear compose, Thinking… + SSE token stream.
pub fn chat_script() -> &'static str {
    r#"(function(){
var form=document.getElementById('compose-form');
var input=document.getElementById('compose-input');
var transcript=document.getElementById('transcript');
if(!form||!input||!transcript)return;
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function appendBubble(role,bodyHtml,attrs){
  var d=document.createElement('div');
  d.className='bubble '+role;
  d.setAttribute('data-role',role);
  if(attrs){for(var k in attrs){if(Object.prototype.hasOwnProperty.call(attrs,k))d.setAttribute(k,attrs[k]);}}
  var meta=document.createElement('div');meta.className='meta';meta.textContent=role==='user'?'you':'agent';
  var body=document.createElement('div');body.className='body';body.innerHTML=bodyHtml;
  d.appendChild(meta);d.appendChild(body);transcript.appendChild(d);return d;
}
function clearEmptyHint(){
  var kids=transcript.querySelectorAll('.bubble');
  if(kids.length===1&&kids[0].querySelector('.body')&&/Say hello/.test(kids[0].textContent||'')){
    transcript.innerHTML='';
  }
}
input.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(typeof form.requestSubmit==='function')form.requestSubmit();else form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));}
});
form.addEventListener('submit',function(e){
  e.preventDefault();
  var text=(input.value||'').trim();
  if(!text||form.dataset.busy==='1')return;
  form.dataset.busy='1';
  input.value='';
  clearEmptyHint();
  appendBubble('user',esc(text),null);
  var agentEl=appendBubble('agent','Thinking…',{'data-streaming':'1'});
  var bodyEl=agentEl.querySelector('.body');
  bodyEl.setAttribute('data-thinking','1');
  bodyEl.textContent='Thinking…';
  var acc='';
  var url=form.getAttribute('action')||form.action;
  fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'text/event-stream'},body:'text='+encodeURIComponent(text)})
  .then(function(res){
    if(!res.ok||!res.body)throw new Error('stream failed');
    var reader=res.body.getReader();
    var dec=new TextDecoder();
    var buf='';
    function pump(){
      return reader.read().then(function(r){
        if(r.done){finish();return;}
        buf+=dec.decode(r.value,{stream:true});
        var parts=buf.split('\n\n');buf=parts.pop()||'';
        for(var i=0;i<parts.length;i++)handleBlock(parts[i]);
        return pump();
      });
    }
    function handleBlock(block){
      var ev='',data=[];
      block.split('\n').forEach(function(line){
        if(line.indexOf('event:')===0)ev=line.slice(6).trim();
        else if(line.indexOf('data:')===0)data.push(line.slice(5).replace(/^ /,''));
      });
      var payload=data.join('\n');
      if(ev==='thinking'){
        bodyEl.setAttribute('data-thinking','1');bodyEl.textContent='Thinking…';
      }else if(ev==='token'){
        if(bodyEl.getAttribute('data-thinking')==='1'){bodyEl.removeAttribute('data-thinking');acc='';}
        acc+=payload;bodyEl.textContent=acc;
      }else if(ev==='done'){
        if(payload){acc=payload;bodyEl.textContent=acc;}
        bodyEl.removeAttribute('data-thinking');
      }
    }
    function finish(){
      agentEl.removeAttribute('data-streaming');
      form.dataset.busy='0';
      input.focus();
    }
    return pump();
  }).catch(function(err){
    bodyEl.removeAttribute('data-thinking');
    bodyEl.textContent='(agent error) '+(err&&err.message?err.message:'stream');
    form.dataset.busy='0';
  });
});
window.__msaChatReady=true;
})();"#
}

/// Web Speech bridge (Chrome). Accepts mock `SpeechRecognition` in tests.
pub fn speech_script() -> &'static str {
    r#"(function(){
var b=document.getElementById('mic-btn');
var i=document.getElementById('compose-input');
if(!b||!i)return;
var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!SR){b.disabled=true;b.title='Speech recognition unavailable';window.__msaSpeechReady=false;return;}
var r=new SR();
r.continuous=false;r.interimResults=false;r.lang='en-US';
function applyTranscript(t){
  if(!t)return;
  i.value=(i.value?i.value+' ':'')+t;
  i.focus();
  i.dispatchEvent(new Event('input',{bubbles:true}));
}
b.addEventListener('click',function(){
  try{r.start();b.classList.add('listening');}catch(e){b.classList.remove('listening');}
});
r.onresult=function(ev){
  try{
    var t=ev.results[0][0].transcript;
    applyTranscript(t);
  }catch(e){}
};
r.onend=function(){b.classList.remove('listening');};
r.onerror=function(){b.classList.remove('listening');};
window.__msaSpeechReady=true;
window.__msaApplySpeech=applyTranscript;
})();"#
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_script_enter_clear_stream_contract() {
        let s = chat_script();
        assert!(s.contains("compose-form"));
        assert!(s.contains("compose-input"));
        assert!(s.contains("Enter"));
        assert!(s.contains("shiftKey"));
        assert!(s.contains("Thinking…") || s.contains("Thinking"));
        assert!(s.contains("text/event-stream"));
        assert!(s.contains("event:"));
        assert!(s.contains("token"));
        assert!(s.contains("input.value=''") || s.contains("input.value=\"\""));
        assert!(s.contains("__msaChatReady"));
    }

    #[test]
    fn speech_script_mic_contract() {
        let s = speech_script();
        assert!(s.contains("mic-btn"));
        assert!(s.contains("compose-input"));
        assert!(s.contains("SpeechRecognition"));
        assert!(s.contains("listening"));
        assert!(s.contains("transcript"));
        assert!(s.contains("__msaSpeechReady"));
    }
}
