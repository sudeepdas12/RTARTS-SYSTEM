import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Link } from "@tanstack/react-router";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Something went wrong</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              An unexpected error occurred. You can try refreshing the page or go back to the dashboard.
            </p>
          </div>
          {this.state.error && (
            <pre className="max-w-lg overflow-auto rounded border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={this.handleReset}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            <Link to="/dashboard">
              <Button>
                <Home className="mr-2 h-4 w-4" />
                Go Home
              </Button>
            </Link>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}