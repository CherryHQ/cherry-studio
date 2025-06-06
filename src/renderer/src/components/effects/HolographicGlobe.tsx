// src/renderer/src/components/effects/HolographicGlobe.tsx
import React from 'react';
import styled, { keyframes } from 'styled-components';

// Keyframes for animation if needed, or directly in SVG <animateTransform>
// const rotateAnimation = keyframes` // Not used as SVG animation is preferred here
//   from {
//     transform: rotate(0deg);
//   }
//   to {
//     transform: rotate(360deg);
//   }
// `;

// Styled component for the SVG container if we want to add external styles or animations
const GlobeWrapper = styled.div`
  width: 64px; // Default size, can be overridden by props
  height: 64px;
  display: inline-block; // Or block, depending on layout needs

  svg {
    width: 100%;
    height: 100%;
    overflow: visible; // Helps if glow slightly exceeds viewBox, though filter should handle
  }
`;

interface HolographicGlobeProps {
  size?: number; // Optional size prop
  className?: string; // For additional styling
}

const HolographicGlobe: React.FC<HolographicGlobeProps> = ({ size = 64, className }) => {
  // The user's template uses SVG <animateTransform> which is good.

  return (
    <GlobeWrapper style={{ width: size, height: size }} className={className}>
      <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="holoGlow" x="-50%" y="-50%" width="200%" height="200%"> {/* Adjusted filter region */}
            <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="skyGradientHolo" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00d2ff" /> {/* Cyan */}
            <stop offset="100%" stopColor="#3a7bd5" /> {/* Blue */}
          </linearGradient>
        </defs>
        <g style={{ filter: 'url(#holoGlow)' }}>
          {/* Main sphere */}
          <ellipse cx="50" cy="50" rx="40" ry="40" stroke="url(#skyGradientHolo)" strokeWidth="1" strokeOpacity="0.8" />

          {/* Equator-like band (slightly thicker or different style for emphasis) */}
          <ellipse cx="50" cy="50" rx="40" ry="15" stroke="url(#skyGradientHolo)" strokeWidth="0.8" strokeOpacity="0.7" />

          {/* Latitude Lines */}
          <path d="M10 50 Q 50 35, 90 50" strokeWidth="0.5" strokeOpacity="0.5" stroke="url(#skyGradientHolo)" />
          <path d="M10 50 Q 50 65, 90 50" strokeWidth="0.5" strokeOpacity="0.5" stroke="url(#skyGradientHolo)" />
          <path d="M20 50 Q 50 42, 80 50" strokeWidth="0.5" strokeOpacity="0.5" stroke="url(#skyGradientHolo)" />
          <path d="M20 50 Q 50 58, 80 50" strokeWidth="0.5" strokeOpacity="0.5" stroke="url(#skyGradientHolo)" />

          {/* Longitude Lines with SVG animation */}
          <path d="M50 10 C 70 30, 70 70, 50 90" strokeWidth="0.5" strokeOpacity="0.6" stroke="url(#skyGradientHolo)">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="20s" repeatCount="indefinite" />
          </path>
          <path d="M50 10 C 30 30, 30 70, 50 90" strokeWidth="0.5" strokeOpacity="0.6" stroke="url(#skyGradientHolo)">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="20s" begin="-10s" repeatCount="indefinite" /> {/* Offset animation start */}
          </path>
          <path d="M50 10 C 60 35, 40 65, 50 90" strokeWidth="0.4" strokeOpacity="0.5" stroke="url(#skyGradientHolo)">
             <animateTransform attributeName="transform" type="rotate" from="45 50 50" to="405 50 50" dur="25s" begin="-5s" repeatCount="indefinite" />
          </path>
           <path d="M50 10 C 40 35, 60 65, 50 90" strokeWidth="0.4" strokeOpacity="0.5" stroke="url(#skyGradientHolo)">
             <animateTransform attributeName="transform" type="rotate" from="-45 50 50" to="315 50 50" dur="25s" begin="-15s" repeatCount="indefinite" />
          </path>

          {/* Adding a few more subtle animated lines for a more "mesh-like" feel */}
           <ellipse cx="50" cy="50" rx="30" ry="30" strokeWidth="0.3" strokeOpacity="0.4" strokeDasharray="2 2" stroke="url(#skyGradientHolo)">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="-360 50 50" dur="30s" repeatCount="indefinite" />
          </ellipse>
           <ellipse cx="50" cy="50" rx="35" ry="35" strokeWidth="0.2" strokeOpacity="0.3" strokeDasharray="1 3" stroke="url(#skyGradientHolo)">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="35s" begin="-7s" repeatCount="indefinite" />
          </ellipse>

        </g>
      </svg>
    </GlobeWrapper>
  );
};

export default HolographicGlobe;
