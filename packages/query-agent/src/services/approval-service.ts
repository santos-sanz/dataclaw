import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export class ApprovalService {
  async ask(command: string, language: "sql" | "python"): Promise<boolean> {
    const rl = readline.createInterface({ input, output });
    output.write("Approval required for mutating command.\n");
    output.write(`Language: ${language}\n`);
    output.write(`Command:\n${command}\n`);
    const answer = (await rl.question("Approve execution? (yes/no): ")).trim().toLowerCase();
    rl.close();
    return answer === "yes" || answer === "y";
  }
}
