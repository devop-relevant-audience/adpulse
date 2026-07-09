"use client";

import React from "react";
import { BiErrorCircle } from "react-icons/bi";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/log";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback UI. When provided, it replaces the default error panel. */
  fallback?: React.ReactNode;
  /**
   * When this value changes, a caught error is cleared automatically. Pass the
   * active view id so switching views recovers from a crashed view.
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Reusable render-error boundary. React error boundaries must be class
 * components, so this stays a class. On catch it reports the error to Sentry
 * and the structured logger, then renders a compact recoverable fallback.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // logger.error is the single Sentry forwarder and carries the component
    // stack for triage (a bare captureException here would only be deduped).
    logger.error("Render error caught by ErrorBoundary", error, {
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private reset = (): void => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 flex flex-col items-center text-center">
        <div className="w-10 h-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-3">
          <BiErrorCircle className="w-5 h-5" />
        </div>
        <p className="text-[13px] font-medium text-ink">Something went wrong loading this view</p>
        <p className="text-[12px] text-ink-muted mt-1 mb-4">
          An unexpected error occurred while rendering this section.
        </p>
        <Button variant="outline" size="sm" onClick={this.reset}>
          Try again
        </Button>
      </div>
    );
  }
}
