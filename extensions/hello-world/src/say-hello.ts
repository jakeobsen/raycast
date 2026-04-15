import { showHUD } from "@raycast/api";

export default async function main(): Promise<void> {
  await showHUD("Hello from Raycast monorepo!");
}
