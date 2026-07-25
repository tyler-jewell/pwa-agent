//! Greenfield Mac Studio setup orchestration.
//! Day-1 entry: `msa setup` (invoked by the single install script).

mod core;

pub use core::{
    plan_setup, run_setup, setup_steps, SetupArgs, SetupReport, SetupStep, SetupStepId,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_includes_web_ui() {
        let full = plan_setup(false);
        assert!(full.contains(&"web UI ready (msa web)"));
        assert_eq!(full.len(), setup_steps().len());
        let skip = plan_setup(true);
        assert_eq!(skip, vec!["web UI ready (msa web)"]);
    }

    #[test]
    fn dry_run_full_plan() {
        let report = run_setup(SetupArgs {
            password: None,
            skip_host: false,
            dry_run: true,
        });
        assert!(report.is_ok());
        if let Ok(report) = report {
            assert!(report.dry_run);
            assert!(report.steps.len() >= 6);
        }
    }

    #[test]
    fn skip_host_without_os_mutation() {
        let report = run_setup(SetupArgs {
            password: None,
            skip_host: true,
            dry_run: false,
        });
        assert!(report.is_ok());
        if let Ok(report) = report {
            assert!(!report.dry_run);
            assert_eq!(report.steps.len(), 1);
        }
    }
}
