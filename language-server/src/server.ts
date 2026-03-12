import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  InitializeParams,
  InitializeResult,
  Diagnostic,
  DiagnosticSeverity,
  TextDocumentChangeEvent
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: false,
      completionProvider: undefined,
      documentFormattingProvider: false
    }
  };
});

// Minimal placeholder diagnostics: flags empty docs and syntax-like warnings in the future.
documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>) => {
  const diagnostics: Diagnostic[] = [];
  // Example: warn if file is empty to show server is alive.
  if (change.document.getText().trim().length === 0) {
    diagnostics.push({
      severity: DiagnosticSeverity.Hint,
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
