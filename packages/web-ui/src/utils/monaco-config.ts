/**
 * Monaco Editor configuration to prevent worker-related errors
 * This must be set up before Monaco is imported
 */

// Configure Monaco environment globally to prevent worker issues
if (typeof window !== 'undefined') {
  // Set up Monaco environment before any imports
  (window as any).MonacoEnvironment = {
    getWorker: function (workerId: string, label: string) {
      // Always return null to disable all workers
      console.log(`Monaco worker requested: ${label} (${workerId}) - disabled`);
      return null;
    },
    getWorkerUrl: function (workerId: string, label: string) {
      // Return empty string to prevent any worker URL resolution
      console.log(`Monaco worker URL requested: ${label} (${workerId}) - disabled`);
      return '';
    },
    // Additional properties to prevent worker creation
    baseUrl: '',
    workerMain: null,
    createTrustedTypesPolicy: () => null
  };


}

/**
 * Configure Monaco language services to disable worker-dependent features
 */
export const configureMonacoLanguages = (monaco: any) => {
  try {
    // Completely disable TypeScript language services
    if (monaco.languages.typescript) {
      // Clear all TypeScript workers and services
      monaco.languages.typescript.getTypeScriptWorker = () => Promise.reject('TypeScript worker disabled');
      monaco.languages.typescript.getJavaScriptWorker = () => Promise.reject('JavaScript worker disabled');

      // TypeScript defaults - disable everything
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
        allowNonTsExtensions: true,
        allowJs: true,
      });

      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
        diagnosticCodesToIgnore: [1108, 1109, 1005, 1003, 1002, 1001]
      });

      // JavaScript defaults - disable everything
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
        allowNonTsExtensions: true,
        target: monaco.languages.typescript.ScriptTarget.Latest,
        allowJs: true,
      });

      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
        diagnosticCodesToIgnore: [1108, 1109, 1005, 1003, 1002, 1001]
      });

      // Disable language features registration
      try {
        monaco.languages.typescript.typescriptDefaults.setEagerModelSync(false);
        monaco.languages.typescript.javascriptDefaults.setEagerModelSync(false);
      } catch (e) {
        console.log('Could not disable eager model sync:', e);
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
 * Get editor options that disable all worker-dependent features
 */
export const getWorkerFreeEditorOptions = () => ({
  // Core editor settings
  automaticLayout: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 14,
  wordWrap: 'on' as const,
  
  // Disable all suggestion and completion features
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  acceptSuggestionOnCommitCharacter: false,
  acceptSuggestionOnEnter: 'off' as const,
  wordBasedSuggestions: 'off' as const,
  wordBasedSuggestionsMode: 'currentDocument' as const,
  
  // Disable parameter hints and hover
  parameterHints: { enabled: false },
  hover: { enabled: false },
  
  // Disable code lens and lightbulb
  codeLens: false,
  lightbulb: { enabled: false },
  
  // Disable folding and links
  folding: false,
  links: false,
  
  // Disable decorators and highlighting
  colorDecorators: false,
  occurrencesHighlight: 'off' as const,
  selectionHighlight: false,
  
  // Disable context menu and mouse features
  contextmenu: false,
  mouseWheelZoom: false,
  
  // Disable validation and diagnostics
  renderValidationDecorations: 'off' as const,
  
  // Disable semantic features
  semanticHighlighting: { enabled: false },
  
  // Disable bracket pair colorization
  'bracketPairColorization.enabled': false,
  
  // Disable inline suggestions
  'editor.inlineSuggest.enabled': false,
  
  // Disable snippet suggestions
  'editor.suggest.showWords': false,
  'editor.suggest.showSnippets': false,
  'editor.suggest.snippetsPreventQuickSuggestions': false,
  
  // Disable language-specific validation
  'typescript.validate.enable': false,
  'javascript.validate.enable': false,
  'json.validate.enable': false,
  'html.validate.scripts': false,
  'html.validate.styles': false,
  'css.validate': false
});
