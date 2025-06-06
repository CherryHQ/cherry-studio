// src/renderer/src/components/effects/CodeAnimator.tsx
import React, { useRef, useEffect } from 'react';
import styled from 'styled-components';

const Canvas = styled.canvas`
  position: fixed; // Use fixed to ensure it covers the whole viewport
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: -1; // Ensure it's behind all other content
  opacity: 0.3; // Start with some opacity, can be adjusted
`;

const CodeAnimator: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas(); // Initial size

    // Characters from the user's template
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>(){}[]/|*+-%=~^;:,.".split('');
    const fontSize = 14;
    let columns = canvas.width / fontSize; // Renamed to 'columns' from 'cols' for clarity

    // Initialize drops array after canvas width is known
    let drops = Array(Math.floor(columns)).fill(1);

    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.04)'; // Slightly transparent black to create fading effect
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Color from user's template, can be themed later
      ctx.fillStyle = '#00d2ff'; // A bright cyan/blue color
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0; // Reset drop to top
        }
        drops[i]++;
      }
    };

    const animate = () => {
      draw();
      animationFrameId = window.requestAnimationFrame(animate);
    };

    animate(); // Start animation

    // Encapsulate resize logic within its own handler function
    const handleResize = () => {
        resizeCanvas();
        // Recalculate columns and reset drops on resize for better behavior
        columns = canvas.width / fontSize; // Update columns count
        drops = Array(Math.floor(columns)).fill(1);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize); // Clean up event listener using the same handler function
    };
  }, []); // Empty dependency array ensures this runs once on mount and cleans up on unmount

  return <Canvas ref={canvasRef} />;
};

export default CodeAnimator;
