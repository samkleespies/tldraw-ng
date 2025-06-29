import { Component, createSignal, onMount } from 'solid-js';
import { getCanvasImages } from '../../utils/vite-canvas-assets';

export interface CanvasImageProps {
  id: number;
  alt?: string;
  style?: string;
  class?: string;
  width?: number;
  height?: number;
}

/**
 * Canvas Image Component - Renders canvas images directly in React/SolidJS
 * 
 * Usage:
 * <CanvasImage id={4} alt="Flower" />
 * <CanvasImage id={4} width={200} height={200} />
 */
export const CanvasImage: Component<CanvasImageProps> = (props) => {
  const [imageUrl, setImageUrl] = createSignal<string>('');
  const [error, setError] = createSignal<string>('');

  onMount(() => {
    try {
      const canvasImages = getCanvasImages();
      const image = canvasImages.find(img => img.id === props.id);
      
      if (image) {
        setImageUrl(image.data_url);
      } else {
        setError(`Canvas image ${props.id} not found`);
      }
    } catch (e) {
      setError(`Failed to load canvas image ${props.id}: ${e}`);
    }
  });

  if (error()) {
    return (
      <div style="color: red; padding: 8px; border: 1px solid red; border-radius: 4px;">
        ❌ {error()}
      </div>
    );
  }

  if (!imageUrl()) {
    return (
      <div style="color: #666; padding: 8px;">
        🔄 Loading canvas image {props.id}...
      </div>
    );
  }

  return (
    <img
      src={imageUrl()}
      alt={props.alt || `Canvas image ${props.id}`}
      style={props.style}
      class={props.class}
      width={props.width}
      height={props.height}
    />
  );
};

/**
 * Hook to get canvas image data URL
 */
export function useCanvasImage(id: number): string | null {
  const [imageUrl, setImageUrl] = createSignal<string | null>(null);

  onMount(() => {
    try {
      const canvasImages = getCanvasImages();
      const image = canvasImages.find(img => img.id === id);
      setImageUrl(image ? image.data_url : null);
    } catch (e) {
      console.error(`Failed to get canvas image ${id}:`, e);
      setImageUrl(null);
    }
  });

  return imageUrl();
}

/**
 * Get all available canvas image IDs
 */
export function getAvailableCanvasImageIds(): number[] {
  try {
    const canvasImages = getCanvasImages();
    return canvasImages.map(img => img.id);
  } catch (e) {
    console.error('Failed to get canvas image IDs:', e);
    return [];
  }
}
