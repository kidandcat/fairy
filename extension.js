const vscode = require('vscode');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads')
const { SpeechRecorder } = require("speech-recorder");
const WebSocket = require('ws')
const play = require('audio-play');
const load = require('audio-loader');

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

const DEBUG = ''

const wsurl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
var statusBarItem
var panel;
var ws;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Fairy is now active!');

	// create a new status bar item that we can now manage
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'fairy.fairy';
	statusBarItem.text = 'Fairy ready';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	panel = vscode.window.createWebviewPanel(
		'audioPlayer',
		'Audio Player',
		vscode.ViewColumn.One,
		{ enableScripts: true, }
	);
	panel.webview.html = `<!DOCTYPE html>
	<html lang="en">
		<head>
		<meta charset="UTF-8">
		<title>Audio Player</title>
		</head>
		<body>
		<div id="info"></div>
		<button onclick="start()">START</button>

		<script>
			var audioContext;
			const i = document.querySelector('#info');
			const button = document.querySelector('button');

			function base64ToArrayBuffer(base64) {
				const binaryString = atob(base64);
				const len = binaryString.length;
				const bytes = new Uint8Array(len);
				for (let i = 0; i < len; i++) {
					bytes[i] = binaryString.charCodeAt(i);
				}
				return bytes.buffer;
			}

			function start(){
				audioContext = new (window.AudioContext || window.webkitAudioContext)({
					sampleRate: 16000
				});
				button.style.display = 'none';
			}

			function playAudioBuffer(audioContext, audioBuffer) {
				const source = audioContext.createBufferSource();
				source.buffer = audioBuffer;
				source.connect(audioContext.destination);
				source.start(0);
			}

			window.addEventListener('message', async (event) => {
				const { command, audioData } = event.data;
				
				if (command == 'transcript') {
					i.innerHTML += audioData
				}

				if (command === 'loadAudio') {
					try {
						i.innerHTML += " Running loadAudio command";
						
						// Decode base64 string to ArrayBuffer
						const arrayBuffer = base64ToArrayBuffer(audioData);
						i.innerHTML += "<br>Decoded ArrayBuffer length: " + arrayBuffer.byteLength;
						
						const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
						playAudioBuffer(audioContext, audioBuffer);

						i.innerHTML += "<br>Audio loaded and ready to play. Unmute and play using the controls below.";
					} catch(e) {
						i.innerHTML += ' Exception: ' + (e.message || e);
					}
				}
			});
		</script>
		</body>
	</html>`;

	ws = new WebSocket(wsurl, {
		headers: {
			"Authorization": "Bearer " + process.env.OPENAI_API_KEY,
			"OpenAI-Beta": "realtime=v1",
		},
	});

	ws.on("open", function open() {
		ws.send(JSON.stringify({
			type: "session.update",
			modalities: ["text", "audio"],
			output_audio_format: "pcm16",
			session: {
				instructions: `
					You are an assistant to help the user control their code editor with their voice.
					You have available functions to control the editor.
					Talk quickly and concisely.
					Always give audio feedback if you received any input.
				`,
				tools: [
					ModifyCode(),
					Save(),
					FocusLines(),
					ListFiles(),
					FindFiles(),
					OpenFile(),
				]
			}
		}));
		ws.send(JSON.stringify({
			type: "response.create",
			response: {
				modalities: ["text"],
				instructions: ".",
			}
		}));
		listen_input();
	});

	var transcriptDelta = '';
	var textDelta = '';
	var audioDelta = [];
	ws.on("message", async function incoming(message) {
		const msg = JSON.parse(message.toString())
		console.log('<<<', msg);
		try {
			switch (msg.type) {
				case 'response.audio.delta':
					audioDelta.push(Buffer.from(msg.delta, 'base64'));
					break;
				case 'response.audio.done':
					const audioBuffer = Buffer.concat(audioDelta);
					const wavBuffer = convertRawToWav(audioBuffer);
					panel.webview.postMessage({
						command: 'loadAudio',
						audioData: wavBuffer.toString('base64'),
					});
					audioDelta = [];
					break;
				case 'response.text.delta':
					textDelta += msg.delta
					break;
				case 'response.text.done':
					vscode.window.showInformationMessage(textDelta);
					textDelta = '';
					break;
				case 'response.audio_transcript.delta':
					panel.webview.postMessage({
						command: 'transcript',
						audioData: msg.delta,
					});
					transcriptDelta += msg.delta
					break;
				case 'response.audio_transcript.done':
					vscode.window.showInformationMessage(transcriptDelta);
					transcriptDelta = '';
					break;
				case 'response.done':
					if (msg.response.status == 'failed') {
						vscode.window.showInformationMessage(msg.response.status_details.error.message);
					}
					break;
				default:
					break;
			}
		} catch (e) {
			vscode.window.showInformationMessage(e.message || e);
		}
	});
}

function deactivate() {
	ws.close()
	recorder.stop()
}

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



function content() {
	var content = vscode.window.activeTextEditor.document.getText()
	var focusedLine = vscode.window.activeTextEditor.selection.active.line
	var startLine = Math.max(0, focusedLine - 1000)
	var endLine = Math.min(vscode.window.activeTextEditor.document.lineCount - 1, focusedLine + 1000)
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

function ModifyCode() {
	return {
		type: 'function',
		function: {
			name: 'ModifyCode',
			description: 'Modify the code using AI',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {
					input: {
						type: 'string',
						description: 'The requested modification (do not include code)',
					},
				},
			},
			function: async ({ input }) => {
				// run aipopup.action.modal.generate command
				vscode.commands.executeCommand('aipopup.action.modal.generate', input)

				// Get the updated content of the first 3 lines
				const document = vscode.window.activeTextEditor.document
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



/////////////////
// AUDIO INPUT //
/////////////////
var recorder;
async function listen_input() {
	console.log('Listening started')
	recorder = new SpeechRecorder({
		// sampleRate: 16000,  // OpenAI expects 16kHz
		onAudio: async ({ audio }) => {
			try {
				const audioBuffer = Buffer.from(audio.buffer);
				ws.send(JSON.stringify({
					type: 'input_audio_buffer.append',
					audio: audioBuffer.toString('base64')
				}));
			} catch (e) {
				console.log(e)
			}
		},
	})
	recorder.start()
	statusBarItem.text = "Listening..."
}

function processAudioChunk(audioChunk) {
	// Convert to 16-bit PCM if needed
	const pcm16Buffer = convertToPCM16(audioChunk);
	return pcm16Buffer.toString('base64');
}

function convertToPCM16(float32Array) {
	const pcm16 = new Int16Array(float32Array.length);
	for (let i = 0; i < float32Array.length; i++) {
		const s = Math.max(-1, Math.min(1, float32Array[i]));
		pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
	}
	return Buffer.from(pcm16.buffer);
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

// Converts a Float32Array to base64-encoded PCM16 data
function base64EncodeAudio(float32Array) {
	const arrayBuffer = floatTo16BitPCM(float32Array);
	let binary = '';
	let bytes = new Uint8Array(arrayBuffer);
	const chunkSize = 0x8000; // 32KB chunk size
	for (let i = 0; i < bytes.length; i += chunkSize) {
		let chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode.apply(null, chunk);
	}
	return btoa(binary);
}

// Converts Float32Array of audio data to PCM16 ArrayBuffer
function floatTo16BitPCM(float32Array) {
	const buffer = new ArrayBuffer(float32Array.length * 2);
	const view = new DataView(buffer);
	let offset = 0;
	for (let i = 0; i < float32Array.length; i++, offset += 2) {
		let s = Math.max(-1, Math.min(1, float32Array[i]));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return buffer;
}

//////////////////
// audio-decode //
//////////////////
var decoder;
const AudioBuffer = globalThis.AudioBuffer;

async function decodeAudio(buf) {
	if (!buf && !(buf.length || buf.buffer)) throw Error('Bad decode target')
	buf = new Uint8Array(buf.buffer || buf)

	if (!decoder) {
		let module = await import('node-wav')
		decoder = module.default.decode
	}
	const decoderBuffer = buf && createBuffer(await decoder(buf))

	return decoderBuffer(buf)
};

function createBuffer({ channelData, sampleRate }) {
	let audioBuffer = new AudioBuffer({
		sampleRate,
		length: channelData[0].length,
		numberOfChannels: channelData.length
	})
	for (let ch = 0; ch < channelData.length; ch++) audioBuffer.getChannelData(ch).set(channelData[ch])
	return audioBuffer
}

// Export all tool functions
module.exports = {
	activate,
	ModifyCode,
	Save,
	DeleteLines,
	FocusLines,
	ListFiles,
	FindFiles,
	OpenFile,
	Response,
};


