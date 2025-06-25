# OpenAI Integration Setup

The AI Chat widget now supports real OpenAI API integration! Follow these steps to enable it.

## 🔑 Getting Your API Key

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the API key (starts with `sk-`)

## ⚙️ Configuration

1. **Set up environment variables:**
   ```bash
   # Copy the example file
   cp .env.example .env
   
   # Edit .env and add your API key
   VITE_OPENAI_API_KEY=sk-your-actual-api-key-here
   ```

2. **Optional configuration:**
   ```bash
   # Change the AI model (default: gpt-4o-mini)
   VITE_OPENAI_MODEL=gpt-4o
   
   # Use custom API endpoint (for Azure OpenAI, etc.)
   VITE_OPENAI_BASE_URL=https://your-custom-endpoint.com/v1
   ```

## 🚀 Usage

1. **Start the development server:**
   ```bash
   pnpm run dev
   ```

2. **Create a Chat widget** on the canvas

3. **Chat with AI!** The AI assistant can help with:
   - Code analysis and suggestions
   - Project structure advice
   - Debugging assistance
   - Shape references using `@shape123` syntax
   - Workspace context awareness

## 🧠 AI Features

### **Workspace Context**
The AI automatically includes context about:
- Current files open in Monaco editors
- Canvas shapes and selections
- Project structure
- File contents for better suggestions

### **Shape References**
Reference specific shapes in your messages:
```
@shape123 - What can I do with this widget?
```

### **Smart Responses**
The AI understands your spatial IDE environment and provides relevant advice for:
- Monaco Editor usage
- Terminal operations
- Preview widget setup
- File management
- Development workflows

## 🔧 Troubleshooting

### **"OpenAI API not configured" message**
- Check that `VITE_OPENAI_API_KEY` is set in your `.env` file
- Restart the development server after adding the API key
- Verify the API key is valid on the OpenAI platform

### **API errors**
- **Invalid API key**: Check your key on the OpenAI platform
- **Quota exceeded**: Check your billing settings
- **Rate limit**: Wait a moment and try again

### **No response from AI**
- Check browser console for error messages
- Verify your internet connection
- Try a simpler message first

## 💰 Cost Considerations

- **gpt-4o-mini** (default): Very cost-effective, good for most tasks
- **gpt-4o**: More capable but higher cost
- **Token usage**: Includes conversation history and workspace context

Monitor your usage on the [OpenAI Usage Dashboard](https://platform.openai.com/usage).

## 🔒 Security

- **Never commit** your `.env` file with real API keys
- The `.env` file is already in `.gitignore`
- API calls are made client-side (required for browser usage)
- Consider using environment-specific API keys for production

## 🎯 Next Steps

With OpenAI integration enabled, you can:
1. Ask for code reviews and suggestions
2. Get help with debugging
3. Discuss architecture decisions
4. Learn about spatial IDE workflows
5. Get contextual help based on your current work

Happy coding with your AI assistant! 🤖✨
