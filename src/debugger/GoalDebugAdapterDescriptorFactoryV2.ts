import * as vscode from 'vscode';
import { GoalDebugSessionV2 } from './DebugAdapterV2';

export class GoalDebugAdapterDescriptorFactoryV2 implements vscode.DebugAdapterDescriptorFactory {
    
    public debugSession?: GoalDebugSessionV2;

    createDebugAdapterDescriptor(
        session: vscode.DebugSession,
        executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        this.debugSession = new GoalDebugSessionV2();
        return new vscode.DebugAdapterInlineImplementation(this.debugSession);
    }
}