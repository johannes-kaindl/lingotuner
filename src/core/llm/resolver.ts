// uebernommen aus koda-agent/src/core/llm/failover.ts (EndpointResolver), 2026-09-07
import { resolveActiveEndpointConfig, type EndpointConfig } from "../../vendor/kit/endpoint_config";

export class EndpointResolver {
  private cached: EndpointConfig | null = null;
  /** Laufender Durchlauf, geteilt — sonst pingt jede gleichzeitige Frage die Liste selbst. */
  private pending: Promise<EndpointConfig | null> | null = null;

  constructor(
    private readonly getEndpoints: () => EndpointConfig[],
    private readonly ping: (ep: EndpointConfig) => Promise<boolean>,
  ) {}

  /** Erster erreichbarer Eintrag, sonst `null`. Ein Fehlschlag wird NICHT gemerkt:
   *  beim nächsten Versuch kann das Netz zurück sein. */
  async resolve(): Promise<EndpointConfig | null> {
    if (this.cached !== null) return this.cached;
    if (this.pending !== null) return this.pending;
    this.pending = resolveActiveEndpointConfig(this.getEndpoints(), this.ping)
      .then((ep) => {
        this.cached = ep;
        return ep;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /** Verwirft den gemerkten Endpunkt; der nächste `resolve()` pingt die Liste erneut. */
  invalidate(): void {
    this.cached = null;
  }
}
