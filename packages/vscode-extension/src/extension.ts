import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Resolve server module relative to workspace root structure
  const serverModule = context.asAbsolutePath(path.join('..', 'language-server', 'start.js'));
  // NOTE: When running from packages/vscode-extension, the language-server is a sibling directory

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'nodeon' }],
    synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.no') }
  };

  client = new LanguageClient('nodeonLanguageServer', 'Nodeon Language Server', serverOptions, clientOptions);
  context.subscriptions.push(client);
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
