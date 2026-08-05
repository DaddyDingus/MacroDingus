import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(frontendRoot, "src/lib/foodEmoji.ts");
const outputDir = resolve(frontendRoot, "public/food-icons/noto");
const source = await readFile(sourcePath, "utf8");
const curatedBlock = source.match(/export const CURATED_FOOD_ICONS: string\[\] = \[([\s\S]*?)\n\];/)?.[1];

if (!curatedBlock) throw new Error("Could not find CURATED_FOOD_ICONS in foodEmoji.ts");

const emojis = [...curatedBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

function codepoints(value) {
  return Array.from(value)
    .map((character) => character.codePointAt(0))
    .filter((codepoint) => codepoint !== 0xfe0e && codepoint !== 0xfe0f);
}

await mkdir(outputDir, { recursive: true });

await Promise.all(emojis.map(async (emoji) => {
  const points = codepoints(emoji);
  const upstreamName = `emoji_u${points.map((point) => point.toString(16)).join("_")}.svg`;
  const localName = `${points.map((point) => point.toString(16)).join("-")}.svg`;
  const url = `https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/${upstreamName}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} fetching ${emoji} from ${url}`);
  await writeFile(resolve(outputDir, localName), await response.text());
}));

const licenseUrl = "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/LICENSE";
const licenseResponse = await fetch(licenseUrl);
if (!licenseResponse.ok) throw new Error(`${licenseResponse.status} fetching ${licenseUrl}`);
await writeFile(resolve(outputDir, "LICENSE"), await licenseResponse.text());

console.log(`Vendored ${emojis.length} Noto food icons into ${outputDir}`);
