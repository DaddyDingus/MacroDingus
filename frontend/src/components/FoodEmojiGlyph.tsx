import { foodEmojiAssetPath, hasBundledFoodEmoji } from "../lib/foodEmoji";

// Food icons retain their emoji string as the stable stored value, but the
// visible glyph comes from a locally bundled Noto SVG. That keeps every
// phone/browser visually consistent and lets unknown user-entered emoji fall
// back harmlessly to the platform renderer instead of showing a broken image.
export default function FoodEmojiGlyph({ value, className = "w-[72%] h-[72%]" }: { value: string; className?: string }) {
  if (!hasBundledFoodEmoji(value)) return <>{value}</>;
  return <img src={foodEmojiAssetPath(value)} alt="" aria-hidden="true" className={`${className} object-contain`} />;
}
