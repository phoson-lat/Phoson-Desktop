import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  /** Etiqueta para identificar el origen en los logs. */
  name?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
}

/**
 * Aísla un crash de render: sin boundary, un error en cualquier componente
 * desmonta el árbol entero y la ventana queda en negro (fondo del tema). Con
 * boundary, la zona afectada muestra el error y el resto de la app sigue viva.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // eslint-disable-next-line no-console -- diagnóstico en consola del devtools
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ""}]`, error, info);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <pre className="max-h-64 w-full overflow-auto whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-left font-mono text-[0.7rem] text-destructive">
            {String(err instanceof Error ? `${err.name}: ${err.message}` : err)}
          </pre>
          <Button size="sm" variant="outline" onClick={this.reset}>
            Reintentar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
