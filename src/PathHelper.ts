import * as fs from 'fs'
import * as path from 'path';

export class PathHelper {


    public static getRootPath(dir: any, counter: number = 0): string {
        if (!dir) return '';
        
        var stats = null;        
        if (fs.existsSync(dir.toString())) {
            stats = fs.statSync(dir.toString())
        } else {
            return "";
        }

        if (stats != null && stats.isFile()) {
            dir = path.dirname(dir)
        }

        var buildDir = path.join(dir, '.build');
        if (fs.existsSync(buildDir)) return path.normalize(dir);

        if (fs.existsSync(path.join(dir, 'Start.goal'))) { return dir; }
        if (!dir.endsWith('setup') && fs.existsSync(path.join(dir, 'Setup.goal'))) { return dir;}

        let parentDir = path.join(dir, '../');
        if (parentDir == dir) return '';
        if (counter > 50 || parentDir == '..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..') {
            console.error('To deep call for dir:' + dir + " | parentDir:" + parentDir + " | buildDir:" + buildDir);
            return '';
        }
        try {
            return this.getRootPath(parentDir, ++counter);
        } catch (e) {
            console.error("Max call stack, parentDir:" + parentDir + " | counter:" + counter);
            console.error(e);
            return '';
        }
    }
}