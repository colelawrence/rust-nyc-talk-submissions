# Brand Style Guide
## Rust NYC Discord Bot - Talk Submission System

### Overview
A nostalgic minimal, slightly technical theme that evokes the feeling of early computing interfaces while maintaining modern usability and accessibility.

### Typography
- **Headings**: Instrument Serif (Google Web Fonts) - Elegant, slightly humanistic serif for warmth
- **Body Text**: System monospace stack for technical authenticity
- **Code/Data**: Monospace for technical content and data display

### Color Palette
```
// Primary - Muted technical grays and warm accents
--bg-primary: #f8f9fa        // Soft off-white background
--bg-secondary: #e9ecef      // Subtle gray for cards
--bg-tertiary: #dee2e6       // Light gray for inputs

--text-primary: #2d3748      // Dark gray for primary text
--text-secondary: #4a5568    // Medium gray for secondary text
--text-muted: #718096        // Light gray for muted text

--accent-primary: #d69e2e     // Warm amber for primary actions
--accent-secondary: #b7791f   // Darker amber for hover states
--accent-subtle: #faf089      // Light amber for subtle highlights

--border-default: #cbd5e0    // Default border color
--border-focus: #d69e2e      // Amber focus borders

// Status colors
--success: #38a169           // Muted green
--error: #e53e3e            // Muted red
--warning: #dd6b20          // Muted orange
--info: #3182ce             // Muted blue
```

### Layout & Spacing
- **Container**: Max-width 480px for mobile-first, intimate feel
- **Spacing Scale**: 4px base unit (4, 8, 12, 16, 24, 32, 48, 64)
- **Border Radius**: 4px for subtle roundness
- **Borders**: 1px solid borders throughout

### Components

#### Cards
- Background: `--bg-secondary`
- Border: 1px solid `--border-default`
- Padding: 24px
- Border radius: 4px
- Subtle drop shadow

#### Forms
- Input borders: 1px solid `--border-default`
- Focus state: 2px solid `--accent-primary`
- Monospace font for consistency
- Generous padding (12px)

#### Buttons
- Primary: `--accent-primary` background, dark text
- Secondary: `--bg-tertiary` background, dark text
- Padding: 12px 24px
- Border radius: 4px
- Monospace font

#### Typography Scale
- H1: 24px / text-2xl (primary headings)
- H2: 20px / text-xl (section headings) 
- H3: 18px / text-lg (subsection headings)
- Body: 14px / text-sm (main content)
- Small: 12px / text-xs (captions, metadata)

**Important**: All headings using Instrument Serif (.font-heading) must be sized at text-2xl (24px) or larger to ensure proper readability and visual hierarchy. The serif font performs best at larger sizes and maintains the technical aesthetic when prominently displayed.

### Design Principles
1. **Functional Beauty**: Every element serves a purpose
2. **Technical Authenticity**: Embrace monospace and structured layouts
3. **Nostalgic Warmth**: Subtle amber accents and serif headings
4. **Accessibility First**: High contrast, clear focus states
5. **Mobile Responsive**: Single-column layouts, touch-friendly sizing

### Implementation Notes
- Use CSS custom properties for consistency
- Maintain semantic HTML structure
- Progressive enhancement approach
- Dark mode consideration for future iterations
