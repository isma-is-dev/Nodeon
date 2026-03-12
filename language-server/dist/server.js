"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
connection.onInitialize((_params) => {
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            hoverProvider: false,
            completionProvider: undefined,
            documentFormattingProvider: false
        }
    };
});
// Minimal placeholder diagnostics: flags empty docs and syntax-like warnings in the future.
documents.onDidChangeContent((change) => {
    const diagnostics = [];
    // Example: warn if file is empty to show server is alive.
    if (change.document.getText().trim().length === 0) {
        diagnostics.push({
            severity: node_1.DiagnosticSeverity.Hint,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 }
            },
            message: 'Nodeon LSP: archivo vacío',
            source: 'nodeon-lsp'
        });
    }
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});
documents.listen(connection);
connection.listen();
