/**
 * Canvas Assets Management System
 *
 * This system provides utilities for managing canvas images as project assets.
 * It enables AI to be aware of canvas images and create proper asset files
 * when needed for project integration.
 */

interface CanvasImage {
  id: number;
  data_url: string;
  width: number;
  height: number;
  original_width: number;
  original_height: number;
  position: { x: number; y: number };
  suggested_filename?: string;
  // Self-documenting action hints
  available_actions?: {
    save_as_asset: {
      action_type: "save_canvas_image";
      description: "Save this canvas image as a project asset file";
      example_usage: "To use this image in code, first save it as an asset, then import it normally";
    };
  };
}

/**
 * Get canvas images from the global whiteboard core
 */
function getCanvasImages(): CanvasImage[] {
  try {
    // Access the global whiteboard core (available in browser context)
    const core = (window as any).whiteboardCore;
    if (!core || !core.get_image_shapes) {
      return [];
    }

    const imageShapesJson = core.get_image_shapes();
    const imageShapes = JSON.parse(imageShapesJson);
    return imageShapes;
  } catch (e) {
    console.log('Could not get canvas images:', e);
    return [];
  }
}

/**
 * Get enhanced canvas images with suggested filenames for AI context
 */
export function getCanvasImagesForAI(): CanvasImage[] {
  const images = getCanvasImages();
  const enhancedImages = images.map((image, index) => ({
    ...image,
    suggested_filename: generateSuggestedFilename(image, index),
    available_actions: {
      save_as_asset: {
        action_type: "save_canvas_image",
        description: "Save this canvas image as a project asset file",
        example_usage: "To use this image in code, first save it as an asset, then import it normally"
      }
    }
  }));

  return enhancedImages;
}

/**
 * Get canvas asset context summary for AI
 */
export function getCanvasAssetContext() {
  const images = getCanvasImagesForAI();

  return {
    images,
    workflow_info: {
      description: "Canvas images are first-class components that can be used directly in React/SolidJS code",
      usage_examples: [
        "// Display a canvas image directly:",
        "<CanvasImage id={4} alt=\"Flower\" />",
        "",
        "// With custom sizing:",
        "<CanvasImage id={4} width={200} height={200} />",
        "",
        "// Get image URL in code:",
        "const imageUrl = useCanvasImage(4);",
        "",
        "// Get all available image IDs:",
        "const ids = getAvailableCanvasImageIds();"
      ],
      import_statement: "import { CanvasImage, useCanvasImage, getAvailableCanvasImageIds } from '../components/canvas/CanvasImage';",
      available_image_ids: images.map(img => img.id),
      notes: [
        "Canvas images work immediately without saving files",
        "Use CanvasImage component for direct rendering",
        "Use useCanvasImage hook to get data URLs",
        "No traditional file imports needed"
      ]
    }
  };
}

/**
 * Generate a suggested filename for a canvas image
 */
function generateSuggestedFilename(image: CanvasImage, index: number): string {
  // Extract file extension from data URL
  const mimeMatch = image.data_url.match(/data:image\/([^;]+)/);
  const extension = mimeMatch ? mimeMatch[1] : 'png';

  // Generate a descriptive name based on position and size
  const x = Math.round(image.position.x);
  const y = Math.round(image.position.y);
  const w = Math.round(image.width);
  const h = Math.round(image.height);

  return `canvas-image-${index + 1}-${w}x${h}.${extension}`;
}

/**
 * Convert data URL to blob
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Save a canvas image as an asset file (triggers download)
 */
export async function saveCanvasImageAsAsset(imageId: number, filename?: string): Promise<string> {
  const images = getCanvasImages();
  const image = images.find(img => img.id === imageId);

  if (!image) {
    throw new Error(`Canvas image with ID ${imageId} not found`);
  }

  const finalFilename = filename || generateSuggestedFilename(image, images.indexOf(image));
  const blob = dataUrlToBlob(image.data_url);

  // Trigger download
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = finalFilename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  console.log(`📥 Downloaded ${finalFilename} - save it to src/assets/ folder`);
  return finalFilename;
}

// This file now provides clean utilities for AI-driven canvas asset management
