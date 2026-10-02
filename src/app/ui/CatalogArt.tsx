import { useState } from "react";
import { GROUP_LABEL } from "../../shared/catalog.ts";
import { Icon, type IconName } from "./icons.tsx";
import { cx } from "./ui.tsx";

// Picture for a catalog plant: its licensed image when the pack provides one, otherwise a botanical
// placeholder for the plant's group — never a photo of a different species.
const GROUP_ICON: Record<string, IconName> = {
  aroid: "leaf", marantaceae: "leaf", ficus: "leaf", dracaena: "leaf", sansevieria: "leaf", hoya: "leaf", peperomia: "leaf", begonia: "leaf",
  foliage: "leaf", fern: "leaf", palm: "leaf", tree: "leaf", vine: "leaf", orchid: "sprout", flower: "sprout", bulb: "sprout", bromeliad: "sprout",
  succulent: "pot", cactus: "pot", carnivorous: "sprout", herb: "sprout", vegetable: "seed", fruit: "seed",
};
export function CatalogArt({ group, image, className, label = true }: { group: string; image?: string; className?: string; label?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) return <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} className={cx("rounded-2xl object-cover", className)} />;
  return (
    <div className={cx("relative grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-sage to-sage-strong text-green", className)} data-testid="catalog-placeholder">
      <Icon name={GROUP_ICON[group] ?? "sprout"} size={40} strokeWidth={1.4} />
      {label && <span className="absolute bottom-1.5 start-2 text-[11px] font-semibold text-green/80">{GROUP_LABEL[group] ?? ""}</span>}
    </div>
  );
}
