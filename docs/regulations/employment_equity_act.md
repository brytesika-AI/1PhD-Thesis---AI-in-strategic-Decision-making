# Employment Equity Act (1998) - AI & Algorithmic Fairness

## Section 6: Prohibition of Unfair Discrimination
No person may unfairly discriminate, directly or indirectly, against an employee, in any employment policy or practice, on one or more grounds of race, gender, sex, pregnancy, marital status, family responsibility, ethnic or social origin, colour, sexual orientation, age, disability, religion, HIV status, conscience, belief, political opinion, culture, language, birth or on any other arbitrary ground.

## Strategic Constraints for AI-Driven People Decisions
1. **Indirect Discrimination (Proxy Variables)**: Using variables such as postcode, credit score, or educational history that statistically correlate with race or class may constitute unfair discrimination.
   - *AI-SRF Implication*: Forensic Analyst must perform a "Distributional Audit" to detect these signatures.
2. **Burden of Proof**: If discrimination is alleged, the employer must prove that the discrimination is fair or that it did not take place.
   - *AI-SRF Implication*: AI "black boxes" are a legal liability. Decision reasoning must be transparent and traceable.

## Fairness Checkpoints
- **Adverse Impact Assessment**: Does the proposed strategy systematically disadvantage a protected group?
- **Proxy Variable Detection**: Are postcode or credit bureaus being used as proxies for race/class?
- **Remediation**: If a bias is detected, the strategy must be modified before proceeding (Hard Safety Constraint).
