import { test, expect } from '@playwright/test';

test.describe('tldraw-ng Basic Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    
    // Wait for the app to initialize
    await expect(page.locator('.status-bar')).toContainText('Ready');
  });

  test('should load and initialize successfully', async ({ page }) => {
    // Check that the canvas is present
    await expect(page.locator('canvas')).toBeVisible();
    
    // Check that toolbar buttons are present
    await expect(page.locator('button:has-text("Select")')).toBeVisible();
    await expect(page.locator('button:has-text("Rectangle")')).toBeVisible();
    await expect(page.locator('button:has-text("Ellipse")')).toBeVisible();
    await expect(page.locator('button:has-text("Line")')).toBeVisible();
    
    // Check status bar shows ready state
    await expect(page.locator('.status-bar')).toContainText('Ready');
    await expect(page.locator('.status-bar')).toContainText('WebGPU Enabled');
  });

  test('should create shapes with tools', async ({ page }) => {
    // Test rectangle creation
    await page.click('button:has-text("Rectangle")');
    await expect(page.locator('button:has-text("Rectangle")')).toHaveClass(/active/);
    
    // Click on canvas to create rectangle
    await page.click('canvas', { position: { x: 400, y: 300 } });
    
    // Verify shape was created
    await expect(page.locator('.status-bar')).toContainText('Shapes: 1');
    
    // Test ellipse creation
    await page.click('button:has-text("Ellipse")');
    await page.click('canvas', { position: { x: 500, y: 200 } });
    
    // Verify shape count increased
    await expect(page.locator('.status-bar')).toContainText('Shapes: 2');
    
    // Test line creation
    await page.click('button:has-text("Line")');
    await page.click('canvas', { position: { x: 300, y: 400 } });
    
    // Verify shape count increased
    await expect(page.locator('.status-bar')).toContainText('Shapes: 3');
  });

  test('should clear all shapes', async ({ page }) => {
    // Create some shapes first
    await page.click('button:has-text("Rectangle")');
    await page.click('canvas', { position: { x: 400, y: 300 } });
    await page.click('canvas', { position: { x: 500, y: 200 } });
    
    // Verify shapes were created
    await expect(page.locator('.status-bar')).toContainText('Shapes: 2');
    
    // Clear all shapes
    await page.click('button:has-text("Clear All")');
    
    // Verify shapes were cleared
    await expect(page.locator('.status-bar')).toContainText('Shapes: 0');
    
    // Clear button should be disabled when no shapes
    await expect(page.locator('button:has-text("Clear All")')).toBeDisabled();
  });

  test('should switch between tools', async ({ page }) => {
    // Start with select tool active
    await expect(page.locator('button:has-text("Select")')).toHaveClass(/active/);
    
    // Switch to rectangle tool
    await page.click('button:has-text("Rectangle")');
    await expect(page.locator('button:has-text("Rectangle")')).toHaveClass(/active/);
    await expect(page.locator('button:has-text("Select")')).not.toHaveClass(/active/);
    
    // Switch to ellipse tool
    await page.click('button:has-text("Ellipse")');
    await expect(page.locator('button:has-text("Ellipse")')).toHaveClass(/active/);
    await expect(page.locator('button:has-text("Rectangle")')).not.toHaveClass(/active/);
    
    // Switch back to select tool
    await page.click('button:has-text("Select")');
    await expect(page.locator('button:has-text("Select")')).toHaveClass(/active/);
    await expect(page.locator('button:has-text("Ellipse")')).not.toHaveClass(/active/);
  });

  test('should handle keyboard shortcuts', async ({ page }) => {
    // Create some shapes
    await page.click('button:has-text("Rectangle")');
    await page.click('canvas', { position: { x: 400, y: 300 } });
    await expect(page.locator('.status-bar')).toContainText('Shapes: 1');
    
    // Press Escape to switch to select tool
    await page.keyboard.press('Escape');
    await expect(page.locator('button:has-text("Select")')).toHaveClass(/active/);
  });
});
