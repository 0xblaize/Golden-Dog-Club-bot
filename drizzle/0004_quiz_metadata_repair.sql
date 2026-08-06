-- Repair rows from the bulk quiz seed that used table-order insertion.
-- Those rows stored category in active and difficulty in category.
UPDATE `quiz_questions`
SET `difficulty` = `category`,
    `category` = `active`,
    `active` = 1
WHERE `active` IN ('web3', 'web2', 'calculation', 'jokes');
