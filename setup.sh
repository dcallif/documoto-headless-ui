#!/bin/bash

# Documoto IPC Viewer - Setup Script
# This script installs all necessary dependencies for the project

set -e

echo "🚀 Setting up Documoto IPC Viewer..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js (v18 or higher) from https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"
echo ""

# Install server dependencies
echo "📦 Installing server dependencies..."
cd server
npm install
echo "✅ Server dependencies installed"
cd ..
echo ""

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
npm install
echo "✅ Frontend dependencies installed"
cd ..
echo ""

# Check for mobile development requirements
echo "📱 Mobile Development Setup"
echo ""

# Check for Android Studio
if command -v adb &> /dev/null; then
    echo "✅ Android SDK detected (adb found)"
else
    echo "⚠️  Android SDK not detected"
    echo "   For Android development, install Android Studio: https://developer.android.com/studio"
fi

# Check for Xcode (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v xcodebuild &> /dev/null; then
        echo "✅ Xcode detected"
    else
        echo "⚠️  Xcode not detected"
        echo "   For iOS development, install Xcode from the App Store"
    fi
fi

echo ""
echo "✨ Setup complete!"
echo ""
echo "Next steps:"
echo ""
echo "For web development:"
echo "  cd server && npm run dev"
echo "  cd frontend && npm run dev"
echo ""
echo "For mobile development:"
echo "  cd frontend && npm run build"
echo "  cd frontend && npm run android:sync  # or npm run ios:sync"
echo ""
echo "See README.md for more details."
