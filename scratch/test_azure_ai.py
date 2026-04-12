import os
from azure.ai.inference import ChatCompletionsClient
from azure.ai.inference.models import SystemMessage, UserMessage
from azure.core.credentials import AzureKeyCredential

def test_ollama():
    client = ChatCompletionsClient(
        endpoint="http://localhost:11434/v1",
        credential=AzureKeyCredential("ollama")
    )
    
    try:
        response = client.complete(
            messages=[
                SystemMessage(content="You are a helpful assistant."),
                UserMessage(content="Say hello world!")
            ],
            model="llama3.2" # Adjust model as needed, it doesn't matter too much if ollama defaults or we fetch status
        )
        print("Response:", response.choices[0].message.content)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    test_ollama()
