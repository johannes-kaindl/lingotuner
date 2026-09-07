// uebernommen aus koda-agent/src/core/llm/failover.ts (EndpointResolver), 2026-09-07
import { resolveActiveEndpointConfig, type EndpointConfig } from "../../vendor/kit/endpoint_config";

/** Ein Durchlauf ueber die Liste, Ergebnis gecacht; invalidate() nach Listen-Aenderung
 *  oder Netzfehler. Der Kit macht bewusst nur EINEN Durchlauf und ueberlaesst das Cachen dem Aufrufer. */
export class EndpointResolver {
  private cached: EndpointConfig | null = null;
  private pending: Promise<EndpointConfig | null> | null = null;

  constructor(
    private readonly getEndpoints: () => EndpointConfig[],
    private readonly ping: (ep: EndpointConfig) => Promise<boolean>,
  ) {}

  async resolve(): Promise<EndpointConfig | null> {
    if (this.cached !== null) return this.cached;
    if (this.pending !== null) return this.pending;
    this.pending = resolveActiveEndpointConfig(this.getEndpoints(), this.ping)
      .then((ep) => { this.cached = ep; return ep; })
      .finally(() => { this.pending = null; });
    return this.pending;
  }

  invalidate(): void { this.cached = null; }
}
