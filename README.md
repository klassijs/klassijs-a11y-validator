# klassijs A11y (Accessibility) Validator

## Overview

**klassijs-a11y-validator** is a powerful tool designed to automate the **verification of accessibility compliance** for digital content, such as websites or applications. It helps developers and testers identify accessibility issues to ensure compliance with WCAG (Web Content Accessibility Guidelines) by programmatically testing elements against established standards (e.g., WCAG 2.0,2.1,2.2 on level A, AA and AAA). The function aims to ensure a more inclusive user experience, especially for individuals with disabilities, by identifying and helping resolve accessibility issues.

## Key Features:

- **Automated Accessibility Testing**: Quickly validates the accessibility of web pages and applications.
- **Compliance Checks**: Ensures your application meets WCAG 2.0/2.1 guidelines and other accessibility standards.
- **Detailed Reporting**: Provides detailed reports on accessibility issues found during validation.
- **Customizable Rules**: Customize which accessibility rules you want to check based on your project's needs.
- **Integration Ready**: Easily integrate into your CI/CD pipelines for continuous accessibility validation.

## Installation

You can easily install the **a11y-validator** using **pnpm**. Follow the steps below:

1. Open your terminal and navigate to your project directory.
2. Run the following command:
   ```bash
   pnpm add klassijs-a11y-validator
   ```

## Usage

Here’s a guide on how to use the **a11y-validator** to check the accessibility of a webpage or application:

1. **Import the Tool**:
   Import the `a11y-validator` module into your project:
   ```javascript
   const { a11yValidator } = require('klassijs-a11y-validator');
   ```

2. **Run Accessibility Validation**:
   Use the `validate` method to check a URL or HTML file for accessibility issues:
   ```javascript
   async function runA11yValidation() {
       try {
           const results = await a11yValidator('https://yourwebsite.com');
           console.log('Accessibility Validation Results:', results);
       } catch (error) {
           console.error('Error during accessibility validation:', error);
       }
   }

   runA11yValidation();
   ```

   The `validate` method will return a detailed report containing any accessibility issues, such as missing alt text, color contrast problems, and other violations of accessibility guidelines.

3. **Review the Report**:
   The results will typically contain details such as:
    - The issue description
    - The severity level (e.g., critical, moderate, minor)
    - The location of the issue (e.g., the affected element)
    - Recommended fixes or actions


## Configuration

You can customize the behavior of **a11y-validator** by providing various options when initializing the validator.

### Custom Rules

You can customize which accessibility rules to check, based on your project's needs. Here's how to pass custom rules:

```javascript
const validator = new a11yValidator({
    rules: ['alt-text', 'color-contrast', 'heading-order']
});
```

### Timeout

If you need to adjust the timeout for validation, you can configure it as follows:

```javascript
const validator = new a11yValidator({
    timeout: 5000 // Timeout in milliseconds
});
```

## Contributing

We welcome contributions! If you encounter any bugs, have suggestions for new features, or want to improve the documentation, feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License.
