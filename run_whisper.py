import sys
import whisper

def transcribe_audio(file_path):
    model = whisper.load_model("base")
    result = model.transcribe(file_path)
    return result["text"]

if __name__ == '__main__':
    file_path = sys.argv[1]  # Get the audio file path from the first command line argument
    print(transcribe_audio(file_path))
