#!/usr/bin/env python3
"""
Test Python script for the web CLI POC
Demonstrates various interactive features
"""

import time
import sys

def main():
    print("🐍 Python CLI Web Interface Test Script")
    print("=" * 40)
    
    # Test basic output
    print("Hello from Python!")
    print("This is a test script to demonstrate the web interface.")
    
    # Test user input
    name = input("What's your name? ")
    print(f"Nice to meet you, {name}!")
    
    # Test multiple inputs
    while True:
        color = input("What's your favorite color? (or 'quit' to exit): ")
        if color.lower() == 'quit':
            break
        print(f"🎨 {color} is a great choice!")
    
    # Test countdown with streaming output
    print("\nStarting countdown...")
    for i in range(5, 0, -1):
        print(f"⏰ {i}...")
        sys.stdout.flush()  # Force output to be sent immediately
        time.sleep(1)
    
    print("🎉 Done! Thanks for testing the Python CLI Web Interface!")

if __name__ == "__main__":
    main()