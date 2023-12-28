import * as vscode from 'vscode';
import { GoalDebugSession } from './debugAdapter';

export class GoalDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    public debugSession? : GoalDebugSession;
    
    
    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // Here, you can create and return a descriptor for your debug adapter.
        // Often, this might involve launching an executable or specifying a named pipe.
        // For simplicity's sake, I'll return an Inline implementation for now.
        this.debugSession = new GoalDebugSession();
        return new vscode.DebugAdapterInlineImplementation(this.debugSession);
    }
}