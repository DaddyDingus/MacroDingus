import { getFoodIcon } from "../lib/foodEmoji";

// Shared emoji-or-letter icon box — used by the Food Log timeline
// (FoodItemCard), the Add Food sheet's browse list, and the header's tiny
// staged-plate avatar stack, so none of them grow their own copy of the
// emoji-vs-letter-avatar branch. Text sizes are overridable since the
// header stack renders this much smaller (w-5) than the list rows (w-8) —
// the default text-lg emoji glyph would overflow a 20px box.
export default function FoodIconAvatar({
  name,
  icon: iconOverride,
  className = "w-8 h-8",
  emojiClassName = "text-lg",
  letterClassName = "text-[13px]",
}: {
  name: string;
  // A food's own stored `icon` column (Food["icon"]) — pass it whenever the
  // caller has a Food object to hand so a user-picked emoji is honored
  // instead of always falling back to the keyword guess.
  icon?: string | null;
  className?: string;
  emojiClassName?: string;
  letterClassName?: string;
}) {
  const icon = getFoodIcon(name, iconOverride);
  return (
    <span
      className={`shrink-0 ${className} rounded-lg bg-white/5 flex items-center justify-center ${emojiClassName} leading-none`}
    >
      {icon.kind === "emoji" ? icon.value : <span className={`${letterClassName} font-bold text-white/90`}>{icon.value}</span>}
    </span>
  );
}
