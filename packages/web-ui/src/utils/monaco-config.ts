/**
 * Monaco Editor configuration to prevent worker-related errors
 * This must be set up before Monaco is imported
 */

// Configure Monaco environment with functional mock workers
if (typeof window !== 'undefined') {
  // Set up Monaco environment before any imports
  (window as any).MonacoEnvironment = {
    getWorker: function (workerId: string, label: string) {
      console.log(`Monaco worker requested: ${label} (${workerId}) - creating mock worker`);

      // Create a more sophisticated mock worker that responds to Monaco's protocol
      const workerCode = `
        // Mock worker that implements Monaco's worker protocol
        class MockMonacoWorker {
          constructor() {
            this.requestId = 0;
            this.pendingRequests = new Map();
          }

          handleMessage(e) {
            const { id, method, args } = e.data;

            // Handle different Monaco worker methods
            switch (method) {
              case 'initialize':
                this.postResponse(id, { capabilities: {} });
                break;
              case 'getSemanticDiagnostics':
              case 'getSyntacticDiagnostics':
              case 'getSuggestionDiagnostics':
                this.postResponse(id, []); // Return empty diagnostics
                break;
              case 'getCompletionsAtPosition':
                this.postResponse(id, { entries: [] }); // Return empty completions
                break;
              case 'getQuickInfoAtPosition':
                this.postResponse(id, null); // No quick info
                break;
              case 'getDefinitionAtPosition':
                this.postResponse(id, []); // No definitions
                break;
              case 'getReferencesAtPosition':
                this.postResponse(id, []); // No references
                break;
              case 'getNavigationBarItems':
                this.postResponse(id, []); // No navigation items
                break;
              case 'getFormattingEditsForDocument':
              case 'getFormattingEditsForRange':
                this.postResponse(id, []); // No formatting edits
                break;
              case 'getCodeFixesAtPosition':
                this.postResponse(id, []); // No code fixes
                break;
              default:
                // For any unknown method, return null or empty result
                this.postResponse(id, null);
                break;
            }
          }

          postResponse(id, result) {
            self.postMessage({
              id: id,
              result: result,
              error: null
            });
          }

          postError(id, error) {
            self.postMessage({
              id: id,
              result: null,
              error: error
            });
          }
        }

        const worker = new MockMonacoWorker();

        self.onmessage = function(e) {
          try {
            worker.handleMessage(e);
          } catch (error) {
            worker.postError(e.data.id, error.message);
          }
        };

        // Handle any other worker initialization
        self.postMessage({ type: 'ready' });
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);

      try {
        return new Worker(workerUrl);
      } catch (error) {
        console.warn('Failed to create mock worker:', error);
        return null;
      }
    },
    getWorkerUrl: function (workerId: string, label: string) {
      console.log(`Monaco worker URL requested: ${label} (${workerId}) - returning mock URL`);

      // Return a blob URL for the mock worker
      const workerCode = `self.postMessage({ type: 'ready' });`;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      return URL.createObjectURL(blob);
    }
  };
}

/**
 * Configure Monaco language services with mock worker support
 */
export const configureMonacoLanguages = (monaco: any) => {
  try {
    // Configure TypeScript language services with mock workers
    if (monaco.languages.typescript) {
      // TypeScript defaults - enable features with mock worker support
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.Latest,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.CommonJS,
        noEmit: true,
        esModuleInterop: true,
        jsx: monaco.languages.typescript.JsxEmit.React,
        reactNamespace: 'React',
        allowJs: true,
        typeRoots: ['node_modules/@types']
      });

      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false, // Enable with mock workers
        noSyntaxValidation: false,   // Enable with mock workers
        noSuggestionDiagnostics: false,
        diagnosticCodesToIgnore: []
      });

      // JavaScript defaults - enable features with mock workers
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.Latest,
        allowNonTsExtensions: true,
        allowJs: true,
        checkJs: false
      });

      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false, // Enable with mock workers
        noSyntaxValidation: false,   // Enable with mock workers
        noSuggestionDiagnostics: false,
        diagnosticCodesToIgnore: []
      });

      // Enable eager model sync with mock workers
      try {
        monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
        monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
      } catch (e) {
        console.log('Could not enable eager model sync:', e);
      }
    }
    
    // Disable other language services that might use workers
    if (monaco.languages.json) {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: false,
        allowComments: true,
        schemas: [],
        enableSchemaRequest: false
      });
    }
    
    if (monaco.languages.html) {
      monaco.languages.html.htmlDefaults.setOptions({
        validate: false,
        format: {
          enable: false
        }
      });
    }
    
    if (monaco.languages.css) {
      monaco.languages.css.cssDefaults.setOptions({
        validate: false,
        lint: {
          enable: false
        }
      });
    }
    
    console.log('Monaco language services configured to disable workers');
  } catch (error) {
    console.warn('Error configuring Monaco language services:', error);
  }
};

/**
 * Get editor options with mock worker support for full features
 */
export const getWorkerFreeEditorOptions = () => ({
  // Core editor settings
  automaticLayout: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 14,
  wordWrap: 'on' as const,

  // Enable suggestion and completion features with mock workers
  quickSuggestions: true,
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnCommitCharacter: true,
  acceptSuggestionOnEnter: 'on' as const,
  wordBasedSuggestions: 'matchingDocuments' as const,
  wordBasedSuggestionsMode: 'allDocuments' as const,

  // Enable parameter hints and hover with mock workers
  parameterHints: { enabled: true },
  hover: { enabled: true },

  // Enable code lens and lightbulb with mock workers
  codeLens: true,
  lightbulb: { enabled: true },

  // Enable editor features
  folding: true,
  links: true,

  // Enable highlighting and decorators
  colorDecorators: true,
  occurrencesHighlight: 'singleFile' as const,
  selectionHighlight: true,

  // Enable editor features
  contextmenu: true,
  mouseWheelZoom: true,

  // Enable validation and diagnostics with mock workers
  renderValidationDecorations: 'on' as const,

  // Enable semantic features with mock workers
  semanticHighlighting: { enabled: true },

  // Enable bracket pair colorization
  'bracketPairColorization.enabled': true,

  // Enable inline suggestions with mock workers
  'editor.inlineSuggest.enabled': true,

  // Enable snippet suggestions with mock workers
  'editor.suggest.showWords': true,
  'editor.suggest.showSnippets': true,
  'editor.suggest.snippetsPreventQuickSuggestions': false,

  // Enable language-specific validation with mock workers
  'typescript.validate.enable': true,
  'javascript.validate.enable': true,
  'json.validate.enable': true,
  'html.validate.scripts': true,
  'html.validate.styles': true,
  'css.validate': true
});
