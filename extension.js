const vscode = require('vscode');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads')
const { SpeechRecorder } = require("speech-recorder");

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

const DEBUG = ''

var statusBarItem

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	const disposable = vscode.commands.registerCommand('fairy.fairy', async function () {
		var activeEditor = vscode.window.activeTextEditor
		if (!activeEditor) {
			return
		}
		var filename = activeEditor.document.uri
		var content = activeEditor.document.getText()
		await run_assistant(filename, content)
		statusBarItem.text = 'Fairy ready';
	});
	context.subscriptions.push(disposable);


	// create a new status bar item that we can now manage
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'fairy.fairy';
	statusBarItem.text = 'Fairy ready';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
}

function add_lines(content) {
	// add line numbers to the code
	var lines = content.split('\n')
	var numbered_lines = []
	for (var i = 1; i <= lines.length; i++) {
		numbered_lines.push(i.toString() + ' ' + lines[i])
	}
	return numbered_lines.join('\n')
}

async function run_assistant(filename, content) {
	var messages = []
	var code = add_lines(content)
	messages.push({
		role: "user", content: `${filename}: 
	${code}`
	})

	var input = await listen_input()
	messages.push({ role: "user", content: input })


	const runner = openai.beta.chat.completions.runTools({
		messages: messages,
		model: 'gpt-4o-mini',
		tools: [
			ReplaceCodeAtLine(),
			Save(),
			DeleteLines(),
			FocusLines(),
			ListFiles(),
			FindFiles(),
			OpenFile(),
			Diagnostic(),
			Response(),
			GetDocumentation(),
		],
	}).on('functionCall', (functionCall) => {
		console.log('functionCall:', functionCall);
		vscode.window.showInformationMessage(functionCall.name + '(' + functionCall.arguments + ')');
	})

	try {
		await runner.done();
	} catch (e) {
		console.log('done Error:', e);
	}
}

function content() {
	var content = vscode.window.activeTextEditor.document.getText()
	var focusedLine = vscode.window.activeTextEditor.selection.active.line
	var startLine = Math.max(0, focusedLine - 400000)
	var endLine = Math.min(vscode.window.activeTextEditor.document.lineCount - 1, focusedLine + 400000)
	var croppedContent = content.split('\n').slice(startLine, endLine + 1).join('\n')
	return add_lines(croppedContent)
}

///////////
// TOOLS //
///////////
// string
// number
// integer
// object
// array
// boolean
// null

function ReplaceCodeAtLine() {
    return {
        type: 'function',
        function: {
            name: 'ReplaceCodeAtLine',
            description: 'Replace code at a specific line',
            parse: JSON.parse,
            parameters: {
                type: 'object',
                properties: {
                    line: {
                        type: 'number',
                        description: 'Line number to replace',
                    },
                    code: {
                        type: 'string',
                        description: 'Code to replace with',
                    },
                },
            },
            function: async ({ line, code }) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return 'No active editor';
                }

                const document = editor.document;
                const lineToReplace = document.lineAt(line - 1);
                const fullRange = lineToReplace.range;

                await editor.edit(editBuilder => {
                    editBuilder.replace(fullRange, code);
                });

                statusBarItem.text = "Replaced code at line " + line;

                // Get the updated content of the first 3 lines
                const updatedContent = document.getText().split('\n').slice(0, 3).join('\n');
                return `${document.uri.toString()}:\n${updatedContent}`;
            },
        },
    };
}

function Save() {
	return {
		type: 'function',
		function: {
			name: 'Save',
			description: 'Save the file',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {},
			},
			function: async () => {
				await vscode.window.activeTextEditor.document.save()
				statusBarItem.text = "Saved file"
				return 'Saved file ' + vscode.window.activeTextEditor.document.uri
			},
		},
	};
}

function DeleteLines() {
	return {
		type: 'function',
		function: {
			name: 'DeleteLines',
			description: 'Delete lines',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {
					start: {
						type: 'number',
						description: 'Start line number to delete',
					},
					end: {
						type: 'number',
						description: 'End line number to delete (exclusive)',
					},
				},
			},
			function: async ({ start, end }) => {
				const startPos = new vscode.Position(start + 1, 0)
				const endPos = new vscode.Position(end + 1, 0)
				await vscode.window.activeTextEditor.edit(editBuilder => {
					editBuilder.delete(new vscode.Range(startPos, endPos))
				})
				statusBarItem.text = `Deleted lines ${start + 1} to ${end + 1}`
				return vscode.window.activeTextEditor.document.uri + ':\n' + content()
			},
		},
	};
}

function FocusLines() {
	return {
		type: 'function',
		function: {
			name: 'FocusLines',
			description: 'Show a range of lines at the center of the screen',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {
					start: {
						type: 'number',
						description: 'Start line number to focus',
					},
					end: {
						type: 'number',
						description: 'End line number to focus (exclusive)',
					},
				},
			},
			function: ({ start, end }) => {
				statusBarItem.text = `Focusing on lines ${start + 1} to ${end + 1}`
				vscode.window.activeTextEditor.revealRange(new vscode.Range(start + 1, 0, end + 1, 0), vscode.TextEditorRevealType.InCenter)
				return `Focused on lines ${start + 1} to ${end + 1}`
			},
		},
	};
}

function ListFiles() {
	return {
		type: 'function',
		function: {
			name: 'ListFiles',
			description: 'List files in the current workspace',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {},
			},
			function: () => {
				const files = vscode.workspace.textDocuments.map(doc => doc.uri.toString())
				var files_list = files.join('\n')
				if (files_list.length > 1000000) {
					files_list = files_list.substring(0, 1000000)
				}
				statusBarItem.text = "Listed files"
				return files_list
			},
		},
	};
}

function FindFiles() {
	return {
		type: 'function',
		function: {
			name: 'FindFiles',
			description: 'Find files in the current workspace based on a provided glob pattern',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {
					pattern: {
						type: 'string',
						description: 'A glob pattern that defines the files to search for. Example: **/*.txt',
					},
				},
			},
			function: async ({ pattern }) => {
				const files = await vscode.workspace.findFiles(pattern)
				var files_list = files.map(file => file.toString()).join('\n')
				if (files_list.length > 1000000) {
					files_list = files_list.substring(0, 1000000)
				}
				statusBarItem.text = "FindFiles"
				return files_list
			},
		},
	};
}

function OpenFile() {
	return {
		type: 'function',
		function: {
			name: 'OpenFile',
			description: 'Open a file in the editor based on a provided uri',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {
					uri: {
						type: 'string',
						description: 'Uri of the file to open',
					},
				},
			},
			function: async ({ uri }) => {
				try {
					const file = vscode.Uri.parse(uri)
					await vscode.window.showTextDocument(file)
					console.log('OpenFile(' + uri + '):', 'Opened file ' + uri);
					return 'Opened file ' + uri
				} catch (e) {
					console.log('OpenFile(' + uri + '):', 'Error opening file ' + uri, e);
					return e.toString()
				}
			},
		},
	};
}

function Diagnostic() {
	return {
		type: 'function',
		function: {
			name: 'Diagnostic',
			description: 'Run diagnostics on the current workspace',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {},
			},
			function: async () => {
				const diagnostics = await vscode.languages.getDiagnostics()
				return diagnostics.map(diagnostic => diagnostic.toString())
			},
		},
	};
}

function Response() {
	return {
		type: 'function',
		function: {
			name: 'Response',
			description: 'Tell something to the user',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {
					response: {
						type: 'string',
						description: 'Text to tell the user',
					},
				},
			},
			function: async ({ response }) => {
				vscode.window.showInformationMessage(response)
				return 'Told user: ' + response
			},
		},
	};
}

function GetDocumentation() {
    return {
        type: 'function',
        function: {
            name: 'GetDocumentation',
            description: 'Get the documentation of a function or symbol',
            parse: JSON.parse,
            parameters: {
                type: 'object',
                properties: {
                    symbol: {
                        type: 'string',
                        description: 'The name of the function or symbol to get documentation for',
                    },
                },
            },
            function: async ({ symbol }) => {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    return 'No active editor';
                }

                const document = activeEditor.document;
                const text = document.getText();
                const regex = new RegExp(`(\\/\\*\\*[^]*?\\*\\/\\s*function\\s+${symbol}\\s*\\([^\\)]*\\))|(\\/\\*\\*[^]*?\\*\\/\\s*${symbol}\\s*:\\s*function\\s*\\([^\\)]*\\))`, 'g');
                const match = regex.exec(text);

                if (match) {
                    const documentation = match[0];
                    statusBarItem.text = `Documentation for ${symbol} found`;
                    return documentation;
                } else {
                    statusBarItem.text = `Documentation for ${symbol} not found`;
                    return `Documentation for ${symbol} not found`;
                }
            },
        },
    };
}

/////////////////
// AUDIO INPUT //
/////////////////

async function listen_input() {
	return new Promise((resolve) => {
		if (DEBUG != '') {
			resolve(DEBUG)
			return
		}
		var data = []
		const recorder = new SpeechRecorder({
			consecutiveFramesForSpeaking: 10,
			onChunkStart: () => {
				statusBarItem.text = "Listening..."
			},
			onAudio: ({ audio }) => {
				data.push(Buffer.from(audio.buffer));
			},
			onChunkEnd: async () => {
				recorder.stop()
				statusBarItem.text = "Processing..."
				const audioBuffer = Buffer.concat(data);
				const wavBuffer = convertRawToWav(audioBuffer);
				const transcription = await openai.audio.transcriptions.create({
					file: await toFile(wavBuffer, "command.wav"),
					model: "whisper-1",
				});
				vscode.window.showInformationMessage(transcription.text)
				resolve(transcription.text)
			}
		})
		statusBarItem.text = "Ready to listen"
		recorder.start()
	});
}

function createWavHeader({ sampleRate, bitDepth, channels, dataLength }) {
	const header = Buffer.alloc(44);

	// "RIFF" chunk descriptor
	header.write('RIFF', 0);                         // ChunkID
	header.writeUInt32LE(36 + dataLength, 4);        // ChunkSize
	header.write('WAVE', 8);                         // Format

	// "fmt " sub-chunk
	header.write('fmt ', 12);                        // Subchunk1ID
	header.writeUInt32LE(16, 16);                    // Subchunk1Size (16 for PCM)
	header.writeUInt16LE(1, 20);                     // AudioFormat (1 for PCM)
	header.writeUInt16LE(channels, 22);              // NumChannels
	header.writeUInt32LE(sampleRate, 24);            // SampleRate
	header.writeUInt32LE(sampleRate * channels * bitDepth / 8, 28); // ByteRate
	header.writeUInt16LE(channels * bitDepth / 8, 32); // BlockAlign
	header.writeUInt16LE(bitDepth, 34);              // BitsPerSample

	// "data" sub-chunk
	header.write('data', 36);                        // Subchunk2ID
	header.writeUInt32LE(dataLength, 40);            // Subchunk2Size

	return header;
}

function convertRawToWav(rawAudioBuffer) {
	const sampleRate = 16000; // 16kHz
	const bitDepth = 16;      // 16-bit
	const channels = 1;       // Mono

	const wavHeader = createWavHeader({
		sampleRate,
		bitDepth,
		channels,
		dataLength: rawAudioBuffer.length,
	});

	return Buffer.concat([wavHeader, rawAudioBuffer]);
}

// Export all tool functions
module.exports = {
	activate,
	ReplaceCodeAtLine,
	Save,
	DeleteLines,
	FocusLines,
	ListFiles,
	FindFiles,
	OpenFile,
	Diagnostic,
	Response,
	GetDocumentation
};
