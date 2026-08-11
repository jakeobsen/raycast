import { randomInt } from "crypto";
import type { NameStyle } from "./prefs";

// Two ~64-word lists → ~4k word pairs. Collisions are handled by the caller (it appends
// -2, -3, … when the directory already exists), so the lists only need to be big enough
// that names stay distinguishable at a glance.
const ADJECTIVES = [
  "amber",
  "ancient",
  "bold",
  "brave",
  "brisk",
  "calm",
  "chatty",
  "clever",
  "cosmic",
  "crimson",
  "curious",
  "dapper",
  "dusty",
  "eager",
  "electric",
  "fancy",
  "feral",
  "fluffy",
  "fuzzy",
  "gentle",
  "gilded",
  "glossy",
  "golden",
  "happy",
  "hidden",
  "humble",
  "icy",
  "idle",
  "jolly",
  "keen",
  "lazy",
  "lively",
  "lucid",
  "lucky",
  "mellow",
  "merry",
  "misty",
  "narrow",
  "neat",
  "nimble",
  "noisy",
  "odd",
  "polite",
  "quiet",
  "rapid",
  "rowdy",
  "rustic",
  "salty",
  "shiny",
  "silent",
  "sleepy",
  "smooth",
  "snappy",
  "solar",
  "spicy",
  "stormy",
  "sturdy",
  "sunny",
  "tidy",
  "tiny",
  "velvet",
  "witty",
  "wobbly",
  "zesty",
] as const;

const NOUNS = [
  "anchor",
  "badger",
  "beacon",
  "bison",
  "bramble",
  "cactus",
  "canyon",
  "cedar",
  "cinder",
  "comet",
  "compass",
  "coral",
  "crane",
  "dolphin",
  "ember",
  "falcon",
  "fern",
  "ferret",
  "fjord",
  "forge",
  "gecko",
  "geyser",
  "glacier",
  "gopher",
  "harbor",
  "hazel",
  "heron",
  "ibex",
  "jasper",
  "kelp",
  "lantern",
  "lemur",
  "lichen",
  "lynx",
  "magpie",
  "marble",
  "meadow",
  "mesa",
  "narwhal",
  "nebula",
  "newt",
  "onyx",
  "otter",
  "owl",
  "panda",
  "pebble",
  "pelican",
  "pine",
  "quartz",
  "quokka",
  "raccoon",
  "reef",
  "ridge",
  "salmon",
  "sparrow",
  "spruce",
  "summit",
  "tapir",
  "thicket",
  "tundra",
  "vulture",
  "walrus",
  "willow",
  "zebra",
] as const;

function pick<T>(list: readonly T[]): T {
  return list[randomInt(list.length)];
}

function hex(bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes; i++) out += randomInt(256).toString(16).padStart(2, "0");
  return out;
}

function isoDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Turn free-text user input into a kebab-case path-safe slug (empty string if nothing survives). */
export function slugify(input: string): string {
  return (
    input
      .normalize("NFKD")
      // Drop the combining marks NFKD just split off, so "ünïcode" folds to "unicode"
      // instead of being chopped into "u-ni-code".
      .replace(/\p{Mark}+/gu, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 40)
      // The slice can leave a trailing separator behind.
      .replace(/-+$/, "")
  );
}

/** Generate a random folder name in the requested style, optionally prefixed with a user label. */
export function generateName(style: NameStyle, label?: string, now: Date = new Date()): string {
  const random =
    style === "hex"
      ? `scratch-${hex(4)}`
      : style === "words-suffix"
        ? `${pick(ADJECTIVES)}-${pick(NOUNS)}-${hex(2)}`
        : style === "date-words"
          ? `${isoDate(now)}-${pick(ADJECTIVES)}-${pick(NOUNS)}`
          : `${pick(ADJECTIVES)}-${pick(NOUNS)}`;

  const slug = label ? slugify(label) : "";
  return slug ? `${slug}-${random}` : random;
}
