# Multi-pizza order variations

Creative two-board order phrasings (model gpt-5.5). Authoring reference; only variations that pass validate-orders get wired in.


## Mode A

1. "One whole Margherita and one whole Pepperoni Classic, please!"  
   _kinds:_ whole Margherita; whole Pepperoni Classic  
   _teaches:_ matching two independent whole pizzas
2. "Could I have a Meat Feast and a Veggie Supreme for our table?"  
   _kinds:_ whole Meat Feast; whole Veggie Supreme  
   _teaches:_ two named recipes on separate pizzas
3. "Please make one BBQ Chicken pizza and one Hawaiian pizza."  
   _kinds:_ whole BBQ Chicken; whole Hawaiian  
   _teaches:_ reading two simple recipe names
4. "I would like a Cheesy Cheese Dream with a Dragon's Breath, thanks!"  
   _kinds:_ whole Cheesy Cheese Dream; whole Dragon's Breath  
   _teaches:_ two whole named pizzas
5. "Make me one pizza with cheese base and no toppings, and one whole Pepperoni Classic."  
   _kinds:_ whole cheese base with no toppings; whole Pepperoni Classic  
   _teaches:_ plain whole pizza plus named recipe
6. "One tomato-base pizza with only mushrooms, and one tomato-base pizza with only olives, please."  
   _kinds:_ whole tomato base with mushroom; whole tomato base with olive  
   _teaches:_ simple single-topping whole pizzas
7. "May I get a whole Gone Bananas and a whole Popeye Power-Up?"  
   _kinds:_ whole Gone Bananas; whole Popeye Power-Up  
   _teaches:_ two independent silly/named recipes
8. "For me, a Margherita; for my friend, a BBQ Chicken."  
   _kinds:_ whole Margherita; whole BBQ Chicken  
   _teaches:_ assigning one whole order to each board
9. "Please build one Lunchbox Tragedy and one Veggie Supreme."  
   _kinds:_ whole Lunchbox Tragedy; whole Veggie Supreme  
   _teaches:_ two named recipes with different topping groups
10. "I need one whole tomato-base pizza with pepperoni, and one whole bbq-base pizza with chicken."  
   _kinds:_ whole tomato base with pepperoni; whole bbq base with chicken  
   _teaches:_ matching base and topping on two whole pizzas
11. "Could you do a Hawaiian pizza and a Cheesy Cheese Dream pizza?"  
   _kinds:_ whole Hawaiian; whole Cheesy Cheese Dream  
   _teaches:_ recognizing two recipe names in one sentence
12. "One pizza should be half Margherita and half Pepperoni Classic; the other should be a whole Meat Feast."  
   _kinds:_ half Margherita and half Pepperoni Classic; whole Meat Feast  
   _teaches:_ simple halves plus one whole pizza
13. "Please make one whole Popeye Power-Up, plus one pizza that is half Hawaiian and half BBQ Chicken."  
   _kinds:_ whole Popeye Power-Up; half Hawaiian and half BBQ Chicken  
   _teaches:_ whole pizza and half-and-half recipe matching
14. "I'll take one whole tomato-base pizza with sweetcorn, and one whole cheese-base pizza with extra cheese."  
   _kinds:_ whole tomato base with sweetcorn; whole cheese base with extra cheese  
   _teaches:_ simple fills using allowed toppings
15. "Today I'd like a Dragon's Breath and a Gone Bananas, both as whole pizzas."  
   _kinds:_ whole Dragon's Breath; whole Gone Bananas  
   _teaches:_ two whole named pizzas with clear board separation

## Mode B

1. "Please make 4 slices of Pepperoni Classic, 8 slices of plain cheese, and 4 slices of Hawaiian."  
   _kinds:_ Pepperoni Classic=4, plain cheese base=8, Hawaiian=4  
   _teaches:_ 4/16=1/4 and 8/16=1/2
2. "I want 2 slices of BBQ Chicken, 10 slices of plain tomato, and 4 slices of Veggie Supreme, please."  
   _kinds:_ BBQ Chicken=2, plain tomato base=10, Veggie Supreme=4  
   _teaches:_ 2/16=1/8, 10/16=5/8, and 4/16=1/4
3. "Could I have 6 mushroom-on-tomato slices, 6 ham-on-cheese slices, and 4 Margherita slices?"  
   _kinds:_ mushroom on tomato base=6, ham on cheese base=6, Margherita=4  
   _teaches:_ 6/16=3/8 and 4/16=1/4
4. "My monster is hungry: 1 slice of Dragon's Breath, 7 slices of plain tomato, and 8 slices of Meat Feast."  
   _kinds:_ Dragon's Breath=1, plain tomato base=7, Meat Feast=8  
   _teaches:_ 1/16, 7/16, and 8/16=1/2
5. "Make half Veggie Supreme, one quarter Pepperoni Classic, and one quarter plain bbq."  
   _kinds:_ Veggie Supreme=8, Pepperoni Classic=4, plain bbq base=4  
   _teaches:_ 1/2=8/16 and 1/4=4/16
6. "I need an eighth Hawaiian, three eighths Cheesy Cheese Dream, and half plain tomato."  
   _kinds:_ Hawaiian=2, Cheesy Cheese Dream=6, plain tomato base=8  
   _teaches:_ 1/8=2/16, 3/8=6/16, and 1/2=8/16
7. "For the banana fan, make one sixteenth banana on cheese base, three sixteenths Gone Bananas, four sixteenths plain cheese, and one half BBQ Chicken."  
   _kinds:_ banana on cheese base=1, Gone Bananas=3, plain cheese base=4, BBQ Chicken=8  
   _teaches:_ Converting 1/16, 3/16, 4/16, and 1/2 to slice counts
8. "Give me 3 slices of bacon on tomato, 5 slices of sausage on cheese, and the rest Popeye Power-Up."  
   _kinds:_ bacon on tomato base=3, sausage on cheese base=5, Popeye Power-Up=8  
   _teaches:_ Finding the remaining 8/16 after 3/16 and 5/16
9. "For my fractions feast, make a quarter Meat Feast, an eighth olive on tomato base, three sixteenths spinach on cheese base, and the remaining seven sixteenths Margherita."  
   _kinds:_ Meat Feast=4, olive on tomato base=2, spinach on cheese base=3, Margherita=7  
   _teaches:_ 1/4=4/16, 1/8=2/16, 3/16, and 7/16
10. "I'd like 5 slices of pineapple on cheese, 5 slices of ham on tomato, 4 slices of Hawaiian, and 2 slices of plain bbq."  
   _kinds:_ pineapple on cheese base=5, ham on tomato base=5, Hawaiian=4, plain bbq base=2  
   _teaches:_ 5/16, 4/16=1/4, and 2/16=1/8
11. "Please build three quarters plain cheese and one quarter Lunchbox Tragedy."  
   _kinds:_ plain cheese base=12, Lunchbox Tragedy=4  
   _teaches:_ 3/4=12/16 and 1/4=4/16
12. "Can you do 1 slice fish heads on bbq, 1 slice marshmallow on tomato, 6 slices Dragon's Breath, and 8 slices Veggie Supreme?"  
   _kinds:_ fish heads on bbq base=1, marshmallow on tomato base=1, Dragon's Breath=6, Veggie Supreme=8  
   _teaches:_ Two 1/16 parts, 6/16=3/8, and 8/16=1/2
13. "Make five sixteenths Pepperoni Classic, five sixteenths Margherita, and three eighths BBQ Chicken."  
   _kinds:_ Pepperoni Classic=5, Margherita=5, BBQ Chicken=6  
   _teaches:_ 5/16 plus 5/16 plus 3/8=6/16
14. "The picnic order is 7 slices of tomato slice on cheese base, 3 slices of sweetcorn on tomato base, 2 slices of peas on cheese base, and 4 slices of Cheesy Cheese Dream."  
   _kinds:_ tomato slice on cheese base=7, sweetcorn on tomato base=3, peas on cheese base=2, Cheesy Cheese Dream=4  
   _teaches:_ 7/16, 3/16, 2/16=1/8, and 4/16=1/4
15. "I would like one eighth meatball on tomato base, a quarter plain tomato, five sixteenths BBQ Chicken, and five sixteenths Popeye Power-Up."  
   _kinds:_ meatball on tomato base=2, plain tomato base=4, BBQ Chicken=5, Popeye Power-Up=5  
   _teaches:_ 1/8=2/16, 1/4=4/16, and two 5/16 parts
