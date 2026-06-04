import React from "react";
import { CROSS_CHAIN_SOURCES } from "@usehatch/sdk";
import { useStoryWiring } from "../lib/story.js";

/* CrossChainSelector — picks the source chain for cross-chain buys + tips.
 *
 * deBridge supports Story Mainnet (chainId 1514) but NOT Aeneid (1315). When
 * the wallet is on Aeneid, this component hides itself entirely — there's no
 * cross-chain path available, so showing a disabled selector would be noise.
 *
 * On mainnet, the component renders the dropdown of supported source chains.
 * The default "Story (native)" maps to value `"native"` so the caller's flow
 * stays single-chain unless the user explicitly picks Base/Optimism/etc.
 *
 * Usage:
 *   const [src, setSrc] = useState("native");
 *   <CrossChainSelector value={src} onChange={setSrc} />
 *   if (src === "native") {  await buyHatch({...})  }
 *   else                  {  await buyHatchCrossChain({ src: ... })  }
 */
export function CrossChainSelector({ value, onChange, label }) {
  const wiring = useStoryWiring();
  const isMainnet = wiring?.hatchConfig.chain.chainId === 1514;
  if (!isMainnet) return null;

  return (
    <label className="body-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="ink-soft" style={{ fontSize: 11 }}>{label ?? "Pay from"}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
        style={{ padding: "6px 8px", fontSize: 12 }}
      >
        <option value="native">Story (native)</option>
        {CROSS_CHAIN_SOURCES.map((s) => (
          <option key={s.chainId} value={String(s.chainId)}>
            {s.name} · {s.paymentSymbol}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Resolve a `<CrossChainSelector>` value back to a CrossChainSource (or null). */
export function resolveCrossChainSource(value) {
  if (!value || value === "native") return null;
  const id = Number(value);
  return CROSS_CHAIN_SOURCES.find((s) => s.chainId === id) ?? null;
}
