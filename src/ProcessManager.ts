import { ChildProcess, spawn } from 'child_process';

export type MessageType = 'output' | 'ask';

export class ProcessManager {
    private processes: Map<string, ChildProcess> = new Map();
    private buffers: Map<string, string> = new Map();

    async run(
        processName: string,
        exePath: string,
        args: string[] = [],
        onMessage?: (type: MessageType, msg: string) => void,
        onError?: (err: string) => void
    ): Promise<ChildProcess | undefined> {
        if (this.processes.has(processName)) return this.processes.get(processName);

        return new Promise((resolve, reject) => {
            const proc = spawn(exePath, args, { shell: true });
            this.processes.set(processName, proc);

            this.buffers.set(processName, '');
            proc.stdout?.on('data', chunk => {
                let buffer = this.buffers.get(processName) || '';
                buffer += chunk.toString();

                // Loop to find all complete messages in the buffer
                while (true) {
                    let startIdx = buffer.indexOf('<<start>>');
                    let askStartIdx = buffer.indexOf('<<ask_start>>');
                    let endIdx = buffer.indexOf('<<end>>');

                    // Pick earliest start marker (if any)
                    let useStart = -1;
                    let type: MessageType = 'output';
                    if (
                        (askStartIdx !== -1 && (askStartIdx < startIdx || startIdx === -1))
                    ) {
                        useStart = askStartIdx;
                        type = 'ask';
                    } else if (startIdx !== -1) {
                        useStart = startIdx;
                        type = 'output';
                    }

                    if (useStart !== -1 && endIdx > useStart) {
                        const contentStart = useStart + (type === 'ask' ? 12 : 9);
                        const msg = buffer.substring(contentStart, endIdx).trim();
                        if (onMessage) onMessage(type, msg);
                        buffer = buffer.substring(endIdx + 6);
                    } else {
                        // No full message yet
                        if (onMessage) onMessage('output', buffer.toString());
                        break;
                    }
                }
                this.buffers.set(processName, buffer);
            });

            proc.stderr?.on('data', data => onError?.(data.toString()));
            proc.on('close', () => {
                this.processes.delete(processName);
                this.buffers.delete(processName);
            });
            proc.on('error', err => {
                this.processes.delete(processName);
                this.buffers.delete(processName);
                onError?.(err.message);
                reject(err);
            });

            resolve(proc);
        });
    }

    async getProcess(processName: string): Promise<ChildProcess | undefined> {
        return this.processes.get(processName);
    }

    async stop(processName: string): Promise<boolean> {
        const proc = this.processes.get(processName);
        if (proc) {
            proc.kill();
            this.processes.delete(processName);
            return true;
        }
        return false;
    }

    async sendInput(processName: string, input: string): Promise<boolean> {
        const proc = this.processes.get(processName);
        if (proc?.stdin && !proc.stdin.destroyed) {
            proc.stdin.write(input + require('os').EOL);
            return true;
        }
        return false;
    }
}
