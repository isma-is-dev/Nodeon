import { CYAN, BOLD, RESET } from "../utils/colors";
import { helpText, version } from "../help-content";

export function printHelp(): void {
  console.log(helpText);
}

export function printVersion(): void {
  console.log(`${CYAN}${BOLD}nodeon v${version}${RESET}`);
}
