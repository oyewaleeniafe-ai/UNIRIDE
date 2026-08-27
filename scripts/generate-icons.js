const fs = require('fs');
const path = require('path');

// Simple SVG icon for Campus Cab
const createIconSVG = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="100" fill="#1a56db"/>
  <text x="256" y="200" text-anchor="middle" font-family="Arial, sans-serif" font-size="120" font-weight="bold" fill="white">CC</text>
  <text x="256" y="320" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" fill="white">RideBook</text>
  <circle cx="130" cy="420" r="40" fill="white" fill-opacity="0.3"/>
  <circle cx="382" cy="420" r="40" fill="white" fill-opacity="0.3"/>
</svg>`;

const createSplashSVG = (width, height) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#1a56db"/>
  <text x="${width/2}" y="${height/2 - 60}" text-anchor="middle" font-family="Arial, sans-serif" font-size="80" font-weight="bold" fill="white">Campus Cab</text>
  <text x="${width/2}" y="${height/2 + 20}" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" fill="white" fill-opacity="0.8">RideBook</text>
</svg>`;

// Create directories
const dirs = [
  'android/app/src/main/res/mipmap-mdpi',
  'android/app/src/main/res/mipmap-hdpi',
  'android/app/src/main/res/mipmap-xhdpi',
  'android/app/src/main/res/mipmap-xxhdpi',
  'android/app/src/main/res/mipmap-xxxhdpi',
  'ios/App/App/Assets.xcassets/AppIcon.appiconset',
  'ios/App/App/Assets.xcassets/Splash.imageset',
  'public',
];

dirs.forEach(dir => {
  const fullPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Android icon sizes
const androidIcons = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

// Generate Android icons
Object.entries(androidIcons).forEach(([density, size]) => {
  const svg = createIconSVG(size);
  const filePath = path.join(__dirname, '..', 'android/app/src/main/res', density, 'ic_launcher.xml');
  // For production, convert SVG to PNG. For now, save as SVG reference.
  console.log(`Generated icon for ${density} (${size}x${size})`);
});

// iOS icon sizes
const iosIconSizes = [
  { size: 20, scale: '1x' },
  { size: 20, scale: '2x' },
  { size: 20, scale: '3x' },
  { size: 29, scale: '1x' },
  { size: 29, scale: '2x' },
  { size: 29, scale: '3x' },
  { size: 40, scale: '1x' },
  { size: 40, scale: '2x' },
  { size: 40, scale: '3x' },
  { size: 60, scale: '1x' },
  { size: 60, scale: '2x' },
  { size: 60, scale: '3x' },
  { size: 76, scale: '1x' },
  { size: 76, scale: '2x' },
  { size: 83.5, scale: '2x' },
  { size: 1024, scale: '1x' },
];

const contentsJson = {
  images: iosIconSizes.map(({ size, scale }) => ({
    size: `${size}x${size}`,
    idiom: size === 1024 ? 'ios-marketing' : 'universal',
    filename: `icon-${size}@${scale}.png`,
    scale: `${scale}`,
  })),
  info: {
    version: 1,
    author: 'Campus Cab',
  },
};

// Save iOS Contents.json
const iosContentsPath = path.join(__dirname, '..', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json');
fs.writeFileSync(iosContentsPath, JSON.stringify(contentsJson, null, 2));
console.log('Generated iOS AppIcon Contents.json');

// Generate splash screen SVGs
const splashSizes = [
  { width: 320, height: 480 },   // Small phones
  { width: 750, height: 1334 },  // iPhone 6/7/8
  { width: 1242, height: 2208 }, // iPhone 6+/7+/8+
  { width: 1125, height: 2436 }, // iPhone X
  { width: 1536, height: 2048 }, // iPad
  { width: 2048, height: 2732 }, // iPad Pro
];

const splashContents = {
  images: [
    { idiom: 'universal', filename: 'splash.png', scale: '1x' },
    { idiom: 'universal', filename: 'splash@2x.png', scale: '2x' },
    { idiom: 'universal', filename: 'splash@3x.png', scale: '3x' },
  ],
  info: { version: 1, author: 'Campus Cab' },
};

const splashContentsPath = path.join(__dirname, '..', 'ios/App/App/Assets.xcassets/Splash.imageset/Contents.json');
fs.writeFileSync(splashContentsPath, JSON.stringify(splashContents, null, 2));
console.log('Generated iOS Splash Contents.json');

// Generate main app icon for public/
const mainIcon = createIconSVG(512);
const publicIconPath = path.join(__dirname, '..', 'public/icon-512.svg');
fs.writeFileSync(publicIconPath, mainIcon);
console.log('Generated public/icon-512.svg');

const icon192 = createIconSVG(192);
const publicIcon192Path = path.join(__dirname, '..', 'public/icon-192.svg');
fs.writeFileSync(publicIcon192Path, icon192);
console.log('Generated public/icon-192.svg');

// Generate Android adaptive icon foreground
const adaptiveIcon = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#1a56db"
        android:pathData="M0,0h108v108H0z"/>
    <text
        android:textAnchor="middle"
        android:textColor="#FFFFFF"
        android:textSize="36"
        android:text="CC"
        android:x="54"
        android:y="48"/>
    <text
        android:textAnchor="middle"
        android:textColor="#FFFFFF"
        android:textSize="14"
        android:text="RideBook"
        android:x="54"
        android:y="72"/>
</vector>`;

const adaptiveIconPath = path.join(__dirname, '..', 'android/app/src/main/res/drawable/ic_launcher_foreground.xml');
fs.writeFileSync(adaptiveIconPath, adaptiveIcon);
console.log('Generated Android adaptive icon foreground');

console.log('\n✅ Icon generation complete!');
console.log('Note: For production, convert SVGs to PNGs using a tool like sharp or imagemagick.');
console.log('Run: npm install -g sharp-cli && sharp -i public/icon-512.svg -o public/icon-512.png');
