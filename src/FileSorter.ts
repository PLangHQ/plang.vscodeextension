import * as fs from 'fs/promises';
import * as path from 'path';

export class FileSorter {
    private directory: string;

    constructor(directory: string) {
        this.directory = directory;
    }

    public async getFilesSortedByModified(): Promise<string[]> {
        try {
            const files = await fs.readdir(this.directory);
            const fileDetails = await Promise.all(
                files.map(async file => {
                    const filePath = path.join(this.directory, file);
                    const stats = await fs.stat(filePath);
                    return { file, mtime: stats.mtime.getTime() };
                })
            );

            return fileDetails
                .sort((a, b) => b.mtime - a.mtime) // Sort by last modified (latest first)
                .map(file => file.file); // Return sorted file names
        } catch (error) {
            console.error('Error reading directory:', error);
            return [];
        }
    }
}
