#!/usr/bin/env python3
"""
Simple calculator for testing input/output
"""

def main():
    print("🧮 Simple Calculator")
    print("-" * 20)
    print("Enter expressions like: 2 + 3, 10 * 5, etc.")
    print("Type 'quit' to exit")
    
    while True:
        try:
            expression = input("Calculate: ").strip()
            
            if expression.lower() == 'quit':
                print("👋 Goodbye!")
                break
                
            # Simple evaluation (unsafe in production, but fine for POC)
            result = eval(expression)
            print(f"Result: {result}")
            
        except Exception as e:
            print(f"❌ Error: {e}")
            print("Please enter a valid mathematical expression")

if __name__ == "__main__":
    main()