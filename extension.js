const vscode = require('vscode');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads')
const { SpeechRecorder } = require("speech-recorder");
const fs = require('fs');

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Congratulations, your extension "fairy2" is now active!');
	// createAssistant()

	const disposable = vscode.commands.registerCommand('fairy2.fairy', function () {
		var activeEditor = vscode.window.activeTextEditor
		if (!activeEditor) {
			return
		}
		var filename = activeEditor.document.uri
		var content = activeEditor.document.getText()
		run_assistant(filename, content)
	});

	context.subscriptions.push(disposable);
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
	for (var i = 0; i < lines.length; i++) {
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

	// string
	// number
	// integer
	// object
	// array
	// boolean
	// null
	const runner = openai.beta.chat.completions.runTools({
		messages: messages,
		model: 'gpt-4o-mini',
		tool_choice: 'required',
		tools: [
			{
				type: 'function',
				function: {
					name: 'ReplaceCodeAtLine',
					description: 'Replace code at a specific line',
					function: ReplaceCodeAtLine,
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
				},
			},
			{
				type: 'function',
				function: {
					name: 'Save',
					description: 'Save the file',
					function: Save,
					parse: JSON.parse,
					parameters: {
						type: 'object',
						properties: {},
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'DeleteLines',
					description: 'Delete lines',
					function: DeleteLines,
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
				},
			},
			{
				type: 'function',
				function: {
					name: 'FocusLine',
					description: 'Scroll to a specific line',
					function: FocusLine,
					parse: JSON.parse,
					parameters: {
						type: 'object',
						properties: {
							line: {
								type: 'number',
								description: 'Line number to focus on',
							},
						},
					},
				},
			},
		],
	}).on('functionCall', (functionCall) => console.log('functionCall', functionCall));

	try {
		await runner.finalChatCompletion();
	} catch (e) {
		console.log('finalChatCompletion Error:', e);
	}
}


async function listen_input() {
	return new Promise((resolve) => {
		var data = []
		const recorder = new SpeechRecorder({
			consecutiveFramesForSpeaking: 10,
			onChunkStart: () => {
				vscode.window.showInformationMessage("Listening...")
			},
			onAudio: ({ audio, speech }) => {
				if (speech) {
					let buffer = Buffer.from(audio.buffer);
					data.push(buffer);
				}
			},
			onChunkEnd: async () => {
				recorder.stop()
				vscode.window.showInformationMessage("Processing...")
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
		vscode.window.showInformationMessage("Ready to listen")
		recorder.start()
	});
}

async function ReplaceCodeAtLine({ line, code }) {
	return new Promise((resolve) => {
		vscode.window.activeTextEditor.edit(editBuilder => {
			const start = new vscode.Position(line, 0)
			const end = new vscode.Position(line, 0)
			editBuilder.replace(new vscode.Range(start, end), code)
			vscode.window.showInformationMessage("Replaced code at line " + line)
			const content = vscode.window.activeTextEditor.document.getText()
			resolve(vscode.window.activeTextEditor.document.uri + ':\n' + add_lines(content))
		})
	})
}

async function DeleteLines({ startLine, endLine }) {
	return new Promise((resolve) => {
		vscode.window.activeTextEditor.edit(editBuilder => {
			const start = new vscode.Position(startLine, 0)
			const end = new vscode.Position(endLine, 0)
			editBuilder.delete(new vscode.Range(start, end))
			vscode.window.showInformationMessage("Deleted lines " + start + " to " + end)
			const content = vscode.window.activeTextEditor.document.getText()
			resolve(vscode.window.activeTextEditor.document.uri + ':\n' + add_lines(content))
		})
	})
}

async function FocusLine({ line }) {
	return new Promise((resolve) => {
		vscode.window.activeTextEditor.selection = new vscode.Selection(line, 0, line, 0)
		resolve('Focused on line ' + line)
	})
}

async function Save() {
	return new Promise((resolve) => {
		vscode.window.activeTextEditor.document.save()
		resolve('Saved file ' + vscode.window.activeTextEditor.document.uri)
	})
}



// AUDIO

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