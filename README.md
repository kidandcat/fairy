# Fairy: Control VS Code with Your Voice

Fairy is an extension for Visual Studio Code that allows you to control the editor using voice commands with Whisper and GPT-4o-mini. This tool is designed to enhance accessibility and efficiency when developing in new environments with limited traditional HID (Human Interface Devices, like keyboards), such as when using a VR headset.

## Features

- **Voice Control**: Use voice commands to perform actions in VS Code.
- **Whisper Integration**: Transcribes your voice commands into text.
- **GPT-4o-mini**: Processes and executes the transcribed commands.
- **Interactive Status Bar**: Displays the current status of the extension and allows you to initiate voice commands.

## Installation

1. Clone this repository:
    ```bash
    git clone https://github.com/kidandcat/fairy.git
    ```
2. Navigate to the project directory:
    ```bash
    cd fairy
    ```
3. Install the dependencies:
    ```bash
    npm install
    ```
4. Open Visual Studio Code in the project directory:
    ```bash
    code .
    ```
5. Press `F5` to start the extension in a new VS Code window.

## Usage

1. Ensure your microphone is connected and working.
2. Click on the status bar icon that says "Fairy ready" to activate listening mode.
3. Speak your command. The extension will transcribe and execute the command in VS Code.

## Available Commands

As Fairy uses an advanced LLM, it understands and executes complex commands. For example, "Create a new JavaScript file named `app.js` and add a function to log 'Hello World'."

Right now the AI has access to the following actions:
- ReplaceCodeAtLine
- Save
- DeleteLines
- FocusLines
- ListFiles
- FindFiles
- OpenFile
- Diagnostic
- Response
- GetDocumentation

## Contributing

Contributions are welcome! Please fork this repository and submit a pull request with your changes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
