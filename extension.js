const vscode = require('vscode');
const { SpeechRecorder } = require("speech-recorder");
const WebSocket = require('ws')

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
				source.playbackRate.value = 1.5;
				source.start(0);
			}

			async function playAudioBufferGranular(audioContext, audioBuffer, speedMultiplier) {
				const grainSize = 0.1; // Duration of each grain in seconds (100ms is a good start)
				const overlap = 0.05; // Overlap between grains in seconds (50ms overlap is common)

				for (let offset = 0; offset < audioBuffer.duration; offset += grainSize - overlap) {
					// Create a new buffer source for each grain
					const source = audioContext.createBufferSource();
					source.buffer = audioBuffer;

					// Define the start and end of each grain
					const grainStart = offset;
					const grainEnd = Math.min(offset + grainSize, audioBuffer.duration);
					
					// Keep playbackRate at 1.0 to preserve pitch
					source.playbackRate.value = 1.5;
					
					// Start the grain at the defined offset
					source.start(audioContext.currentTime, grainStart, grainEnd - grainStart);

					// Connect the grain to the audio output
					source.connect(audioContext.destination);

					// Adjust the delay between grains based on speedMultiplier
					const adjustedGrainInterval = (grainSize - overlap) / speedMultiplier;
					await new Promise(resolve => setTimeout(resolve, adjustedGrainInterval * 1000));
				}
			}

			window.addEventListener('message', async (event) => {
				const { command, audioData } = event.data;
				
				if (command == 'transcript') {
					i.innerHTML += audioData
				}

				if (command === 'loadAudio') {
					try {						
						// Decode base64 string to ArrayBuffer
						const arrayBuffer = base64ToArrayBuffer(audioData);
						const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
						i.innerHTML += '<br>'
						await playAudioBufferGranular(audioContext, audioBuffer, 2.5);
						// playAudioBuffer(audioContext, audioBuffer);
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
			session: {
				output_audio_format: "pcm16",
				instructions: `
					You are an assistant to help the user control their code editor with their voice.
					You have available functions to control the editor.
					Talk quickly and concisely.
					You should always call a function if you can.

					If you understood these instructions, answer with READY.`,
				tools: Object.values(tools).map(t => t().function)
			}
		}));
		ws.send(JSON.stringify({
			type: "response.create",
			response: {
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
				case 'error':
					vscode.window.showInformationMessage(msg.error.message)
					break;
				case 'response.function_call_arguments.done':
					vscode.window.showInformationMessage(msg.name + '(' + msg.arguments + ')');
					var output = ''
					try {
						output = await tools[msg.name]().function.function(JSON.parse(msg.arguments));
					} catch (e) {
						output = e.message || e
					}
					const msgout = {
						type: "conversation.item.create",
						item: {
							type: "function_call_output",
							call_id: msg.call_id,
							output
						}
					}
					ws.send(JSON.stringify(msgout));
					setTimeout(() => {
						ws.send(JSON.stringify({
							type: "response.create",
							response: {
								modalities: ["text", "audio"],
							}
						}));
					}, 100);
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

function add_lines_around(content, line, margin) {
	var lines = content.split('\n')
	var numbered_lines = []
	for (var i = 1; i <= lines.length; i++) {
		numbered_lines.push(i.toString() + ' ' + lines[i])
	}
	// if the line is 8 and the margin is 2, then we want to add lines 6 to 10
	var start = Math.max(1, line - margin)
	var end = Math.min(lines.length, line + margin)
	numbered_lines = numbered_lines.slice(start - 1, end)
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

const tools = {
	ReplaceCode,
	Save,
	FocusLines,
	ListFiles,
	FindFiles,
	OpenFile,
	OpenFile,
	FileContent,
}

function ReplaceCode() {
	return {
		type: 'function',
		function: {
			name: 'ReplaceCode',
			type: 'function',
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
				const start = new vscode.Position(line-1, 0)
				const end = new vscode.Position(line, 0)
				await vscode.window.activeTextEditor.edit(editBuilder => {
					editBuilder.replace(new vscode.Range(start, end), code + '\n')
				})
				statusBarItem.text = "Replaced code at line " + line
				const content = vscode.window.activeTextEditor.document.getText()
				return vscode.window.activeTextEditor.document.uri + ':\n' + add_lines_around(content, line, 5)
			},
		},
	};
}

function FileContent() {
	return {
		type: 'function',
		function: {
			name: 'FileContent',
			type: 'function',
			description: 'Get the content of the currently focused file',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {},
			},
			function: async () => {
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
			type: 'function',
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
			type: 'function',
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
				return vscode.window.activeTextEditor.document.uri + ':\n' + add_lines_around(content(), start, 5)
			},
		},
	};
}

function FocusLines() {
	return {
		type: 'function',
		function: {
			name: 'FocusLines',
			type: 'function',
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
			function: async ({ start, end }) => {
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
			type: 'function',
			description: 'List files in the current workspace',
			parse: JSON.parse,
			parameters: {
				type: 'object',
				properties: {},
			},
			function: async () => {
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
			type: 'function',
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
				if (files_list == '') return ListFiles().function.function()
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
			type: 'function',
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
			type: 'function',
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
	ReplaceCode,
	Save,
	DeleteLines,
	FocusLines,
	ListFiles,
	FindFiles,
	OpenFile,
	Response,
};


