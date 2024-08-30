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
	const disposable = vscode.commands.registerCommand('fairy2.fairy', async function () {
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
	statusBarItem.command = 'fairy2.fairy';
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
		],
	}).on('functionCall', (functionCall) => {
		console.log('functionCall:', functionCall.name);
		vscode.window.showInformationMessage('Calling function: ' + functionCall.name);
	})

	try {
		await runner.done();
	} catch (e) {
		console.log('done Error:', e);
	}
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
				const start = new vscode.Position(line, 0)
				const end = new vscode.Position(line + 1, 0)
				await vscode.window.activeTextEditor.edit(editBuilder => {
					editBuilder.replace(new vscode.Range(start, end), code + '\n')
				})
				statusBarItem.text = "Replaced code at line " + line
				const content = vscode.window.activeTextEditor.document.getText()
				return vscode.window.activeTextEditor.document.uri + ':\n' + add_lines(content)
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
				statusBarItem.text = "Deleted lines " + start + 1 + " to " + end + 1
				const content = vscode.window.activeTextEditor.document.getText()
				return vscode.window.activeTextEditor.document.uri + ':\n' + add_lines(content)
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
				statusBarItem.text = "Focusing on lines " + start + 1 + " to " + end + 1
				vscode.window.activeTextEditor.revealRange(new vscode.Range(start + 1, 0, end + 1, 0), vscode.TextEditorRevealType.InCenter)
				return 'Focused on lines ' + start + 1 + ' to ' + end + 1
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
				return files.join('\n')
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
						description: 'Glob pattern to search for',
					},
				},
			},
			function: ({pattern}) => {
				const files = vscode.workspace.findFiles(pattern)
				return files.map(file => file.toString())
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
			function: ({uri}) => {
				const file = vscode.Uri.parse(uri)
				vscode.window.showTextDocument(file)
				return 'Opened file ' + uri
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