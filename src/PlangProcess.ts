import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { PathHelper } from "./PathHelper";
import * as path from 'path';

export class PlangProcess {
    private process: ChildProcessWithoutNullStreams | undefined;
    appPath : string;
    constructor(appPath : string) {
        this.appPath = appPath;
    }

    public callGoal(
        goalPath: string,
        args: string[],
        standard: (s: string) => void,
        error: (s: string) => void,
        delta?: (s: string) => void
    ) {
        const allArgs = [path.join(this.appPath, goalPath), ...args];

        if (!this.process || this.process.stdin.destroyed) {
            this.process = spawn('plang', allArgs, { cwd: __dirname, stdio: "pipe" });
        }

        this.process.stdout.on("data", data => {
            const str = data.toString();
            standard(str);
            if (delta) delta(str);
        });

        this.process.stderr.on("data", data => {
            const str = data.toString();
            error(str);
            if (delta) delta(str);
        });

        this.process.on("error", err => {
            error(err.message);
        });
    }

    send(input: string) {
        if (this.process && !this.process.stdin.destroyed) {
            this.process.stdin.write(input + "\n");
        }
    }

    kill() {
        if (this.process) this.process.kill();
    }
}
