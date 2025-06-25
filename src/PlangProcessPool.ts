import { ChildProcessWithoutNullStreams, spawn } from "child_process";

type Task = {
    command: string;
    args: string[];
    callback: (result: string) => void;
};

export class PlangProcessPool {
    private poolSize: number;
    private processes: ChildProcessWithoutNullStreams[] = [];
    private availableProcesses: ChildProcessWithoutNullStreams[] = [];
    private taskQueue: Task[] = [];

    constructor(poolSize: number = 2) {
        this.poolSize = poolSize;
        this.initializePool();
    }

    private initializePool(): void {
        for (let i = 0; i < this.poolSize; i++) {
            this.createProcess();
        }
    }

    private createProcess(): void {
        const proc = spawn("plang", [], { stdio: ["pipe", "pipe", "pipe"] });

        proc.on("exit", () => {
            console.log(`Plang process exited, respawning...`);
            this.processes = this.processes.filter(p => p !== proc);
            this.createProcess();
        });

        proc.on("error", (err) => {
            console.error(`Plang process error: ${err.message}`);
        });

        this.processes.push(proc);
        this.availableProcesses.push(proc);
    }

    public runCommand(command: string, args: string[], callback: (result: string) => void): void {
        if (this.availableProcesses.length > 0) {
            const proc = this.availableProcesses.shift()!;
            proc.stdin.write(`${command} ${args.join(" ")}\n`);

            proc.stdout.once("data", (data: Buffer) => {
                this.availableProcesses.push(proc);
                callback(data.toString().trim());

                // Process queued tasks if any
                if (this.taskQueue.length > 0) {
                    const nextTask = this.taskQueue.shift()!;
                    this.runCommand(nextTask.command, nextTask.args, nextTask.callback);
                }
            });
        } else {
            this.taskQueue.push({ command, args, callback });
        }
    }

    public dispose(): void {
        this.processes.forEach(proc => proc.kill());
        this.processes = [];
        this.availableProcesses = [];
    }
}
