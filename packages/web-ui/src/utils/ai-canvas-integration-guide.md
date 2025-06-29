# AI Canvas Integration Guide

## How the Elegant Canvas Asset System Works

### 1. **Canvas Image Awareness**
When you paste an image on the canvas, the AI automatically knows about it through the enhanced context:

```json
{
  "imageShapes": [
    {
      "id": 1,
      "position": { "x": 100, "y": 200 },
      "width": 300,
      "height": 200,
      "original_width": 600,
      "original_height": 400,
      "data_url": "data:image/jpeg;base64,/9j/4AAQ...",
      "suggested_filename": "canvas-image-1-300x200.jpeg"
    }
  ]
}
```

### 2. **AI Can Reference Images Intelligently**
The AI can see:
- How many images are on canvas
- Their positions and sizes
- Suggested filenames based on dimensions
- The actual image data

### 3. **Smart Asset Creation**
When the AI wants to use a canvas image in code, it can:

1. **Reference the image by ID**: "I can see canvas image #1 (300x200 pixels)"
2. **Create the asset file**: Use the `save_canvas_image` action
3. **Write proper import code**: Generate correct import statements

### 4. **Example AI Workflow**

**User**: "Add the flower image to my project"

**AI Response**: 
```
I can see canvas image #1 (a 300x200 pixel image). Let me save it as an asset and add it to your project.

**Actions:**
1. Save canvas image as "flower.jpeg"
2. Create import statement in App.tsx
3. Add image to component

**Code:**
```jsx
import flowerImage from './assets/flower.jpeg';

function App() {
  return (
    <div>
      <h1>Hello World!</h1>
      <img src={flowerImage} alt="Beautiful flower" style={{width: '300px'}} />
    </div>
  );
}
```

This creates a natural, intelligent workflow where:
- ✅ AI sees what's on canvas
- ✅ AI creates proper asset files  
- ✅ AI writes correct import code
- ✅ User just saves the downloaded file to src/assets/
- ✅ Everything works seamlessly

### 5. **Benefits of This Approach**

1. **No Magic/Hidden Behavior** - Everything is explicit and visible
2. **Scalable** - Works with multiple images, different formats
3. **Developer-Friendly** - Standard import/asset workflow
4. **AI-Aware** - AI knows exactly what images are available
5. **Performance** - No background scanning or error interception
