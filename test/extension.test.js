/* global jest */
const assert = require('assert');
const vscode = require('vscode');
const { expect, beforeAll } = require('@jest/globals');

jest.mock('vscode', () => ({
  window: {
    activeTextEditor: {
      document: {
        uri: { toString: jest.fn().mockReturnValue('file:///test/file.js') },
        getText: jest.fn().mockReturnValue('Line 1\nLine 2\nLine 3'),
        save: jest.fn().mockResolvedValue(true),
        lineAt: jest.fn().mockReturnValue({ text: 'Sample text' }),
        positionAt: jest.fn(),
        lineCount: 3,
      },
      edit: jest.fn().mockImplementation(callback => {
        const editBuilder = {
          replace: jest.fn(),
          delete: jest.fn(),
        };
        callback(editBuilder);
        return Promise.resolve(true);
      }),
      revealRange: jest.fn(),
      selection: {  // Add this block
        active: {
          line: 0
        }
      },
    },
    showTextDocument: jest.fn().mockResolvedValue(undefined),
    showInformationMessage: jest.fn(),
    createStatusBarItem: jest.fn().mockReturnValue({
      text: '',
      show: jest.fn(),
      hide: jest.fn(),
      command: '',
    }),
  },
  Position: class {},
  Range: class {},
  Uri: {
    parse: jest.fn().mockImplementation(uri => ({ toString: () => uri })),
  },
  workspace: {
    findFiles: jest.fn().mockResolvedValue([]),
  },
  languages: {
    getDiagnostics: jest.fn().mockResolvedValue([]),
  },
  commands: {
    registerCommand: jest.fn(),
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  TextEditorRevealType: {
    InCenter: 2,  // The actual value doesn't matter for the mock
  },
}), { virtual: true });

// Import tools after mocking vscode
const {
    ReplaceCodeAtLine,
    Save,
    DeleteLines,
    FocusLines,
    ListFiles,
    FindFiles,
    OpenFile,
    Diagnostic,
    Response,
    GetDocumentation,
	activate,
} = require('../extension');

// At the top of your test file, after the vscode mock
const mockContext = {
    subscriptions: []
};

describe('Extension Test Suite', () => {
    beforeAll(() => {
        activate(mockContext);
        vscode.window.showInformationMessage('Start all tests.');
    });

    describe('Tool Functions', () => {
        afterEach(() => {
            jest.clearAllMocks();
        });

        test('ReplaceCodeAtLine', async () => {
            await ReplaceCodeAtLine().function.function({ line: 1, code: 'New code' });
            expect(vscode.window.activeTextEditor.edit).toHaveBeenCalledTimes(1);
        });

        test('Save', async () => {
            const result = await Save().function.function();
            expect(vscode.window.activeTextEditor.document.save).toHaveBeenCalledTimes(1);
            expect(result).toContain('Saved file');
        });

        test('DeleteLines', async () => {
            await DeleteLines().function.function({ start: 1, end: 3 });
            // Check if edit was called
            expect(vscode.window.activeTextEditor.edit).toHaveBeenCalled();
            // Check if the statusBarItem text was updated
            expect(vscode.window.createStatusBarItem().text).toBe("Deleted lines 2 to 4");
        });

        test('FocusLines', () => {
            const result = FocusLines().function.function({ start: 1, end: 3 });
            console.log('FocusLines result:', result); // Add this line
            assert(result.includes('Focused on lines 2 to 4'));
        });

        test('ListFiles', () => {
            vscode.workspace.textDocuments = [{ uri: { toString: () => 'file1.js' } }, { uri: { toString: () => 'file2.js' } }];
            const result = ListFiles().function.function();
            assert(result.includes('file1.js') && result.includes('file2.js'));
        });

        test('FindFiles', async () => {
            vscode.workspace.findFiles.mockResolvedValue([{ toString: () => 'found_file.js' }]);
            const result = await FindFiles().function.function({ pattern: '**/*.js' });
            expect(result).toContain('found_file.js');
            expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/*.js');
        });

        test('OpenFile', async () => {
            const testUri = 'file:///test/open_file.js';
            const result = await OpenFile().function.function({ uri: testUri });
            expect(vscode.Uri.parse).toHaveBeenCalledWith(testUri);
            expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
            expect(result).toContain('Opened file');
        });

        test('Diagnostic', async () => {
            vscode.languages.getDiagnostics.mockResolvedValue([{ toString: () => 'Test diagnostic' }]);
            const result = await Diagnostic().function.function();
            expect(result).toContain('Test diagnostic');
        });

        test('Response', async () => {
            const result = await Response().function.function({ response: 'Test response' });
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Test response');
            expect(result).toContain('Told user: Test response');
        });

        test('GetDocumentation', async () => {
            vscode.window.activeTextEditor.document.getText = jest.fn().mockReturnValue('/** Test documentation */\nfunction testFunction() {}');
            const statusBarItem = vscode.window.createStatusBarItem();
            const result = await GetDocumentation().function.function({ symbol: 'testFunction' });
            expect(result).toContain('Test documentation');
            expect(statusBarItem.text).toBe('Documentation for testFunction found');
        });
    });

    describe('FocusLines', () => {
		afterEach(() => {
            jest.clearAllMocks();
        });

        test('Focus on lines 1 to 3', async () => {
            const result = await FocusLines().function.function({ start: 1, end: 3 });
            expect(result).toBe('Focused on lines 2 to 4');
        });

        test('Focus on a single line', () => {
            const result = FocusLines().function.function({ start: 5, end: 5 });
            assert(result.includes('Focused on lines 6 to 6'));
        });

        test('Focus on a larger range', async () => {
            const result = await FocusLines().function.function({ start: 0, end: 10 });
            
            // Assert that revealRange was called
            expect(vscode.window.activeTextEditor.revealRange).toHaveBeenCalledWith(
                expect.any(vscode.Range),
                vscode.TextEditorRevealType.InCenter
            );
            
            expect(result).toBe('Focused on lines 1 to 11');
        });
    });
});
